
var http = require('http');
var app = require('express')();
var server = http.createServer(app)


server.listen(3001);

app.use(function (req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', "http://"+req.headers.host+':8000');

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
	})
	socket.on('login', function(user) {
		console.log('login request received');
		nickname = user.username;
		av = user.avatar;

		users.push({
			username: user.username,
			socket: socket
		});

		

		console.log("user " + user.username + " has signed on");
		console.log(users);
		socket.broadcast.emit('user-list', user);
		
	});

	socket.on('user-list', function(user) {
		socket.broadcast.emit('user-list', user);
	});

});

function sendMessage(message) {

	for (var i = 0; i < users.length; i++) {
		if (users[i].username == message.to) {
			console.log(users[i].username);
			users[i].socket.emit('message', message);
			return true;
		}
	}
	return false;
}

