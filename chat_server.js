
var http = require('http');
var express = require('express');
var app = express();
var server = http.createServer(app);	
var MongoClient = require('mongodb').MongoClient;
var time = require('time')(Date);
var fs = require('fs');
var uuid = require('node-uuid');
var ip = require('ip');
var AWS = require('aws-sdk');

var s3;

var url = process.env.DATABASE_URL;

//var server_host = process.env.NODE_ENV == 'development' ? 'http://' + ip.address() + ':3001' : 'http://blogger243chat.herokuapp.com'

//development uses server_host for image uploads, production uses client for s3 uploads
var server_host = 'http://' + ip.address() + ':3001';


server.listen(process.env.PORT || 3001);

app.use(function (req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', "http://blogger-243.herokuapp.com");

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        next();
    }
);
app.use(express.static('public'));



if (process.env.NODE_ENV == 'production') {
	s3 = new AWS.S3();
}


var io = require('socket.io').listen(server);

var users = [];

io.on('connection', function(socket) {
	var nickname = '';
	var av = '';


 
	socket.on('disconnect', function() {
		console.log("user has disconnected");
		for (var i = 0; i < users.length; i ++) {
			if (users[i].socket.id == socket.id) {
				console.log("removing user from list");
				users.splice(i,1);
				break;
			}
		}

		//only emit a logout if the user has no more active sockets open
		var found = false;
		for (var i = 0; i < users.length; i++) {
			if (users[i].username == nickname) {
				found = true;
				break;
			}
		}
		if (!found) {
			io.emit('logout', nickname);
		}
	});

	socket.on('list', function() {
		console.log("list request received, broadcasting list-username to all users");
		io.emit('list');


		io.emit('user-list', {
			username: nickname,
			avatar: av
		});
			

	});


	socket.on('message', function(message) {
		console.log(message.type + " message received, sending to appropriate person: " + message.to);
		if (message.type == 'text') {
			//send message like normal
			sendMessage(message);			
		}
		else {
			//it's an image, need to create the image file and pass the image path back to the user

			var blank_file = uuid.v4() + '-' + new Date().getTime() + '.' + message.extension;;

			if (process.env.NODE_ENV == 'development') {
				//development, create image locally and send url back to user.
				blank_file = 'public/images/' + blank_file;
				fs.writeFile(blank_file, message.content, 'binary', function() {
					//finished writing file, send the message using the standard function. can differentiate at client using the .type element
					var image_url = server_host + '/' + blank_file.split('public/')[1];
					message.content =  '<a href="' + image_url + '"><img src="' + image_url + '" class="chat-image-file"></a>';
					console.log(message.content)
					
					sendMessage(message);
				});
			}
			else {				
				//production, need to use s3 because files do not persist on heroku
				fs.writeFile(blank_file, function() {
					s3.putObject({
						Bucket: process.env.AWS_BUCKET_NAME,
						Key: blank_file,
						ContentType: 'image/' + message.extension,
						SourceFile: blank_file,
					},
					function(err, data) {
						if (err) {
							message.content = err;
							sendMessage(message);
						}
						else {
							console.log('file uploaded to s3 successfully');
							//need to construct the url
							message.content = getS3Url(blank_file);

							sendMessage(message);
						}
					})
				})
				
			}
		}
	})

	socket.on('history_request', function(message) {
		connect_db(function(db) {
			console.log("request for logs received, attempting to send them...");
			chatHistory(message.toid, message.fromid, db, function(chat_logs) {
				console.log('chat logs reversed:');
				console.log(chat_logs);

				//send the chat logs back to the requesting user, which is in message.from

				for (var i = 0; i < users.length; i++) {
					if (users[i].username == message.from) {
						users[i].socket.emit('chat_history', {
							to: message.to,
							chat_logs: chat_logs
						});
					} 
				}
			});
	

			
		})
	})
	socket.on('login', function(user) {
		console.log('login request received');
		nickname = user.username;
		av = user.avatar;

		users.push({
			username: user.username,
			socket: socket
		});

		//remove any duplicates that may exist

		// for (var i = 0; i < users.length; i++) {
		// 	if (users[i].username == user.username && users[i].socket.id != socket.id) {
		// 		console.log("\x1b[31m", 'duplicate found, removing socket with id ' + users[i].socket.id + ". Current socket's ID: " + socket.id)
		// 		console.log("\x1b[0m", '');
		// 		users.splice(i,1);	
		// 	}
		// }

		

		console.log("user " + user.username + " has signed on");
		console.log(users);
		socket.broadcast.emit('user-list', user);
		
	});

	socket.on('user-list', function(user) {
		socket.broadcast.emit('user-list', user);
	});

});

function sendMessage(message) {
	console.log("attempting to send message");
	console.log(message);

	var messageSent = false;
	for (var i = 0; i < users.length; i++) {
		if (users[i].username == message.to) {
			console.log("sending message to: " + users[i].username + ", socket id: " + users[i].socket.id);
			users[i].socket.emit('message', message);
			messageSent = true;
		}
	}


	connect_db(function(db) {
		insertRecord(message, db, function(result) {
			console.log('closing database...');
			db.close();
		});
	})

	return messageSent
}

function insertRecord(record, db, callback) {
	var collection = db.collection('chat_logs')

	date = new Date();

	date.setTimezone('America/Los_Angeles');

	console.log(record);


	collection.insert({
		to: record.toid,
		from: record.fromid,
		message: record.content,
		sent_at: date
	}, 
	function(err, result) {
		if (!err) {
			console.log("record inserted in db successfully")
			//console.log(result);
		}

		callback(result);
	});	
}

function chatHistory(user1, user2, db, callback) {
	//console.log(db.collection('chat_logs'));
	db.collection('chat_logs').find({
		$or: [
			{
				$and: [
					{to: parseInt(user1)},
					{from: parseInt(user2)}
				]

			},
			{
				$and: [
					{to: parseInt(user2)},
					{from: parseInt(user1)}
				]
			}
		]
	})
	.sort({sent_at: -1})
	.limit(25)
	.toArray(function(err, results) {
		if (err == null) {
			console.log(results);
			callback(results.reverse());
		}
	})
}

function connect_db(callback) {
	MongoClient.connect(url, function(err, db) {
		if (!err) {
			console.log('connected to database successfully')
			callback(db);
		} 
		else  {
			console.log(err)
		}
	})

}

function getS3Url(file) {
	//given the bucket name, region, and file, we can construct the url ourselves

	return 'https://' + process.env.AWS_REGION + '.amazonaws.com/' + process.env.AWS_BUCKET_NAME + '/' + file;

}