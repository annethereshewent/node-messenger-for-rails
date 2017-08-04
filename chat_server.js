
var http = require('http');
var app = require('express')();
var server = http.createServer(app);	
var MongoClient = require('mongodb').MongoClient;
var time = require('time')(Date);


var url = process.env.NODE_ENV == 'development' ? 'mongodb://localhost:27017/blogger' : 'mongodb://heroku_cbslmh5x:m950ufunlkmupd62objrdnkqmp@ds137749.mlab.com:37749/heroku_cbslmh5x';





server.listen(process.env.PORT || 3001);

app.use(function (req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', "http://blogger-243.herokuapp.com");

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        next();
    }
);

var io = require('socket.io').listen(server);

var users = [];

io.on('connection', function(socket) {
	var nickname = '';
	var av = '';



	socket.on('disconnect', function() {
		console.log("user has disconnected");
		for (var i = 0; i < users.length; i ++) {
			if (users[i].username == nickname) {
				console.log("removing user from list");
				users.splice(i,1);
				break;
			}
		}
		io.emit('logout', nickname);
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
		console.log("message received, sending to appropriate person: " + message.to);
		sendMessage(message);

		//store message in database
		connect_db(function(db) {
			insertRecord(message, db, function(result) {
				console.log('closing database...');
				db.close();
			});
		})
	})

	socket.on('history_request', function(message) {
		connect_db(function(db) {
			console.log("request for logs received, attempting to send them...");
			chatHistory(message.to, message.from, db, function(chat_logs) {
				console.log(chat_logs);

				//send the chat logs back to the requesting user, which is in message.from

				for (var i = 0; i < users.length; i++) {
					if (users[i].username == message.from) {
						users[i].socket.emit('chat_history', {
							to: message.to,
							chat_logs: chat_logs
						});
						break;
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

		for (var i = 0; i < users.length; i++) {
			if (users[i].username == user.username && users[i].socket.id != socket.id) {
				console.log("\x1b[31m", 'duplicate found, removing socket with id ' + users[i].socket.id + ". Current socket's ID: " + socket.id)
				console.log("\x1b[0m", '');
				users.splice[i,1];
			}
		}

		

		console.log("user " + user.username + " has signed on");
		console.log(users);
		socket.broadcast.emit('user-list', user);
		
	});

	socket.on('user-list', function(user) {
		socket.broadcast.emit('user-list', user);
	});

});

function sendMessage(message) {
	var messageSent = false;
	for (var i = 0; i < users.length; i++) {
		if (users[i].username == message.to) {
			console.log("sending message to: " + users[i].username + ", socket id: " + users[i].socket.id);
			users[i].socket.emit('message', message);
			messageSent = true;
		}
	}
	return messageSent
}

function insertRecord(record, db, callback) {
	var collection = db.collection('chat_logs')

	date = new Date();

	date.setTimezone('America/Los_Angeles');

	collection.insert({
		to: record.to,
		from: record.from,
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
	console.log("attempting to fetch chat history....");
	//console.log(db.collection('chat_logs'));
	db.collection('chat_logs').find({
		$or: [
			{
				$and: [
					{to: user1},
					{from: user2}
				]

			},
			{
				$and: [
					{to: user2},
					{from: user1}
				]
			}
		]
	})
	.sort({sent_at: -1})
	.limit(50)
	.toArray(function(err, results) {
		if (err == null) {
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