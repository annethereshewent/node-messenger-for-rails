
const http = require('http'),
 	  express = require('express'),
  	  app = express(),
      server = http.createServer(app),
      MongoClient = require('mongodb').MongoClient,
      fs = require('fs'),
      uuid = require('node-uuid'),
      colors = require('colors'),
      AWS = require('aws-sdk');

let s3;

let url = process.env.NODE_DATABASE_URL;

let timeout = 0

let server_host = 'http://localhost:3001';

let current_time = new Date().getTime()

server.listen(process.env.PORT || 3001);

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', "http://blogger-243.herokuapp.com");

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});

app.use(express.static('public'));



if (process.env.NODE_ENV == 'production') {
	s3 = new AWS.S3();
}


let io = require('socket.io').listen(server);

let users = [];

// connect_db(funection(db) {
// 	db.collection('chat_logs').find({
// 		message: /10.0.0.135/
// 	})
// 	.toArray()
// 	.then(function(wrong_chat_logs) {
// 		for (let i = 0; i < wrong_chat_logs.length; i++) {
// 			let new_message = wrong_chat_logs[i].message.replace(/10.0.0.135/g, '10.0.0.136');
// 			console.log(new_message);
// 			try {
// 				db.collection('chat_logs').update(
// 					{ _id: wrong_chat_logs[i]._id},
// 					{ $set: { message: new_message} }
// 				)
// 			}
// 			catch (e) {
// 				console.log(e);
// 			}
// 		}
// 	})

	
// })

io.on('connection', function(socket) {
	let nickname = '';
	let av = '';
	let user_id = null;


 
	socket.on('disconnect', function() {
		console.log("user has disconnected");
		for (let i = 0; i < users.length; i ++) {
			if (users[i].socket.id == socket.id) {
				console.log("removing user from list");
				users.splice(i,1);
				break;
			}
		}

		//only emit a logout if the user has no more active sockets open
		let found = false;
		for (let i = 0; i < users.length; i++) {
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


		// io.emit('user-list', {
		// 	username: nickname,
		// 	avatar: av,
		// 	user_id: user_id
		// });
			

	});


	socket.on('message', function(message) {
		console.log(message.type + " message received, sending to appropriate person: " + message.to);
		if (message.type == 'text') {
			//send message like normal
			sendMessage(message);			
		}
		else {
			//it's an image, need to create the image file and pass the image path back to the user

			let blank_file = uuid.v4() + '-' + new Date().getTime() + '.' + message.extension;;

			if (process.env.NODE_ENV == 'development') {
				//development, create image locally and send url back to user.
				blank_file = 'public/images/' + blank_file;
				fs.writeFile(blank_file, message.content, 'binary', function() {
					//finished writing file, send the message using the standard function. can differentiate at client using the .type element
					let image_url = `${server_host}/${blank_file.split('public/')[1]}`;
					message.content =  getImageHtml(image_url);
					
					sendMessage(message);
				});
			}
			else {				
				//production, need to use s3 because files do not persist on heroku

				s3.putObject({
					Bucket: process.env.AWS_BUCKET_NAME,
					Key: blank_file,
					ContentType: 'image/' + message.extension,
					Body: new Buffer(message.content, 'binary')
				},
				function(err, data) {
					if (err) {
						console.log(err);
					}
					else {
						console.log('file uploaded to s3 successfully');
						let s3_url = getS3Url(blank_file);
						//need to construct the url
						message.content = getImageHtml(s3_url);

						sendMessage(message);
					}
				})				
			}
		}
	})

	socket.on('history_request', function(message) {
		connect_db(function(db) {
			console.log("request for logs received, attempting to send them...");
			chatHistory(message.toid, message.fromid, db, function(chat_logs) {
				//console.log('chat logs reversed:');
				//console.log(chat_logs);

				//send the chat logs back to the requesting user, which is in message.from

				for (let i = 0; i < users.length; i++) {
					if (users[i].username == message.from) {
						console.log("emitting chat_logs to " + users[i].socket.id)
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
		user_id = user.user_id;

		users.push({
			username: user.username,
			socket: socket
		});

		//remove any duplicates that may exist

		// for (let i = 0; i < users.length; i++) {
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

	socket.on('user-list', (user) => {
		let time_difference = new Date().getTime() - current_time
		current_time = new Date().getTime()
		setTimeout(() => {
			console.log(`broadcasting ${user.username}`)
			socket.broadcast.emit('user-list', user);	
		}, timeout)

		if (time_difference < 2000 || timeout == 0) {
			timeout = timeout + 2000
		}
		else {
			timeout = 0
		}
	});

});

function sendMessage(message) {
	console.log("attempting to send message");
	console.log(message);

	let messageSent = false;
	for (let i = 0; i < users.length; i++) {
		if (users[i].username == message.to) {
			console.log("sending message to: " + users[i].username + ", socket id: " + users[i].socket.id);
			users[i].socket.emit('message', message);
			messageSent = true;
		}
	}

	console.log(messageSent ? "message was sent successfully" : "message was not sent");

	connect_db(function(db) {
		insertRecord(message, db, function(result) {
			console.log('closing database...');
			db.close();
		});
	})

	return messageSent
}

function insertRecord(record, db, callback) {
	let collection = db.collection('chat_logs')

	date = new Date();

	date.setTimezone('America/Los_Angeles');

	//console.log(record);


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
			//console.log(results);
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

	return 'https://s3-' + process.env.AWS_REGION + '.amazonaws.com/' + process.env.AWS_BUCKET_NAME + '/' + file;

}

function getImageHtml(img_src) {
	return '<a href="' + img_src + '"><img src="' + img_src + '" class="chat-image-file"></a>';
}