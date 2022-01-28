const cmdArgs = require('command-line-args')
const express = require('express');
const app = express();
const https = require('https')
const http = require('http')
const bodyParser = require('body-parser');
const socket = require('socket.io');
const request = require('request');
const rp = require('request-promise');
const events = require('events');
const amqp = require('amqplib');
const fs = require('fs');
const eventEmitter = new events.EventEmitter();


const cmdOptions = [
	{ name: 'port', alias: 'p', type: String },
	{ name: 'https', type: Boolean },
	{ name: 'privkey', type: String },
	{ name: 'cert', type: String },
	{ name: 'amqp', alias: 'm', type: String },
	{ name: 'config', alias: 'c', type: String }

]

const options = cmdArgs(cmdOptions)

const config = require(options.config || './config.json')

let server = null
if(options.https) {
	const privateKey = fs.readFileSync(oprions.privkey).toString();
	const certificate = fs.readFileSync(option.cert).toString();
	const credentials = {key: privateKey, cert: certificate}
	server = https.createServer(credentials, app)
} else {
	server = http.createServer(app)
}

const io = socket(server);

//app.use(express.static(__dirname + '/'));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(express.static('./'));
app.get('/', function(req, res,next) {
    res.sendFile(__dirname + '/html/index.html');
});

port = options.port || 4200
myAddress = 'frontend'
amqpHost = config.host || process.env.AMQP_HOST || 'dex-01.lab.uvalight.net'
sockets = []
domains = [
	{address: "maBFUimrYV4x-XIjq8z1IxtPBmnrqVxTxkS3aPAJI-c=", name: "OMC"},
	{address: "ef2PJLWaSu8DNm1IdNX3a-lS2yDnFLWqXYWGnzyfK3Q=", name: "VMCA"},
	{address: "AmOP8CKG3jLnFfRUxus3Neqq07dw0b4YwB6lYiLVg-g=", name: "POLICE"}
	//{address: "BKiSghyaKuzBK2IMuG1Xx_j1FREw9V9-E6d3S6VsFbc=", name: "AS-004"}
]
nodes = [
	{address:"JmyIfXieSYcwN78HTRMokRskX33L7AvW49fNGlNL_dw=", domain:"maBFUimrYV4x-XIjq8z1IxtPBmnrqVxTxkS3aPAJI-c=", state: "CREATE", type: "bucket", details:
		{
			address:"JmyIfXieSYcwN78HTRMokRskX33L7AvW49fNGlNL_dw=", domain:"maBFUimrYV4x-XIjq8z1IxtPBmnrqVxTxkS3aPAJI-c=",
		}},
	{address:"twhgFJ9AUwWzVsgEOIIowZuzpzVWGBGGIgbGRe2FxTU=", domain:"BKiSghyaKuzBK2IMuG1Xx_j1FREw9V9-E6d3S6VsFbc=", state: "CREATE", type: "bucket", 
		details: {address:"twhgFJ9AUwWzVsgEOIIowZuzpzVWGBGGIgbGRe2FxTU=", domain:"BKiSghyaKuzBK2IMuG1Xx_j1FREw9V9-E6d3S6VsFbc="}
	},
	{address:"QWqewsadtwhgFJ9AUwWzVsgEOII", domain:"AmOP8CKG3jLnFfRUxus3Neqq07dw0b4YwB6lYiLVg-g=", state: "CREATE", type: "bucket",
		details: {address:"QWqewsadtwhgFJ9AUwWzVsgEOII", domain:"AmOP8CKG3jLnFfRUxus3Neqq07dw0b4YwB6lYiLVg-g="}
	},
	{address:"HgdfgsdftwhgFJ9AUwWzVsgEOIIowZuzpz", domain:"ef2PJLWaSu8DNm1IdNX3a-lS2yDnFLWqXYWGnzyfK3Q=", state: "CREATE", type: "bucket",
		details: {address:"HgdfgsdftwhgFJ9AUwWzVsgEOIIowZuzpz", domain:"ef2PJLWaSu8DNm1IdNX3a-lS2yDnFLWqXYWGnzyfK3Q="}
	}
]
links = [
 {"address": "FrVDqDeshIhgrBBDvAuBTbNH-ksr9CUt3MrtgGhNOGc=", "type": "bucket", "domain": "maBFUimrYV4x-XIjq8z1IxtPBmnrqVxTxkS3aPAJI-c=", "state": "CONNECTED", "details": {"bucket": "JmyIfXieSYcwN78HTRMokRskX33L7AvW49fNGlNL_dw=", "src": "JmyIfXieSYcwN78HTRMokRskX33L7AvW49fNGlNL_dw=", "dest": "twhgFJ9AUwWzVsgEOIIowZuzpzVWGBGGIgbGRe2FxTU=", "endpoint": {"public_key": "nfdPHY60xhZTzSTLfapdKfKpuLjnDsUPwVqjsNaTNXo=", "endpoint_ip": "2001:610:2d0:130:ecea:45ff:fe02:c742", "endpoint_port": 13409, "virtual_ip": "2001:2f:6662:6662:3434:6239:6137:3365"}}}
]

policies = {
	"Auditor_OMC":"cG9saWN5MShwYXJraW5nMSwgb21jLCB2bWNhLCB0cmFmZmljX2RpdmVyc2lvbiwgZW1lcmdlbmN5KS4KCnNpZ25hdHVyZShEYXRhc2V0LFNlbmRlcixSZWNlcGllbnQsUHVycG9zZSkgOi0gfm5vcm1hbF9jb25kaXRpb24gJiBwb2xpY3kxKEQsUyxSLFB1cixFbnYpICYgRCA9PSBEYXRhc2V0ICYgUyA9PSBTZW5kZXIgJiBSID09IFJlY2VwaWVudCAmIFB1ciA9PSBQdXJwb3NlLgoKLy9yZWplY3Rpb24oRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpIDotIHBvbGljeShELFMsUixQdXIpICYgKEQgXD09IERhdGFzZXQgfCBTIFw9PSBTZW5kZXIgfCBSIFw9PSBSZWNlcGllbnQgfCBQdXIgXD09IFB1cnBvc2UpLgoKK25vcm1hbF9jb25kaXRpb246dHJ1ZSA8LQoJIXBlcmNlcHRfZW52aXJvbm1ybnQuCgovL1BlcmNlcHQgdGhlIGVudmlyb25tZW50LCB1cGRhdGUgaXQncyBiZWxpZWYgYWJvdXQgZW52aXJvbm1lbnQKLy8rbmVlZF9hdXQoRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpOnRydWUgPC0KCS8vIXBlcmNlcHRfZW52aXJvbm1ybnQuCgorfm5vcm1hbF9jb25kaXRpb246dHJ1ZSA8LQoJIXBlcmNlcHRfZW52aXJvbm1ybnQuCgkKKyFwZXJjZXB0X2Vudmlyb25tcm50IDogfm5vcm1hbF9jb25kaXRpb24gPC0gCgkucHJpbnQoIk5vdyBpcyB1bmRlciBlbWVyZ2VuY3kgY29uZGl0aW9uIik7CgkhanVkZ2UuIC8vIEp1ZGdlIHRoZSByZXF1ZXN0CgorIXBlcmNlcHRfZW52aXJvbm1ybnQgOiBub3JtYWxfY29uZGl0aW9uIDwtCgkucHJpbnQoIk5vdyBpcyB1bmRlciBub3JtYWwgY29uZGl0aW9uIik7CgkhanVkZ2UuIC8vIEp1ZGdlIHRoZSByZXF1ZXN0CgovL0lmIHRoZXJlIGlzIHJlcXVlc3QgbmVlZCB0byBiZSBhdWRpdCBhbmQgdGhlIHJlcXVlc3QgYmUgYXV0aG9yaXplZCwgZ2l2ZSBzaWduaXR1cmUKKyFqdWRnZTogbmVlZF9hdXQoRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpICYgc2lnbmF0dXJlKERhdGFzZXQsU2VuZGVyLFJlY2VwaWVudCxQdXJwb3NlKTwtCgkucHJpbnQoIlRoaXMgcmVxdWVzdCBpcyBjb21wbGlhbnQuIik7Cgkhc2lnbmF0dXJlOwoJc2lnbmF0dXJlOyAvL2dpdmUgc2lnbml0dXJlCgkrc2lnbmVkKERhdGFzZXQsU2VuZGVyLFJlY2VwaWVudCxQdXJwb3NlKTsgLy8gbG9nOiB3aGljaCByZXF1ZXN0IGhhcyBiZWVuIHNpZ25lZAoJLW5lZWRfYXV0KERhdGFzZXQsU2VuZGVyLFJlY2VwaWVudCxQdXJwb3NlKS4gLy8gZGVsZXRlIHRoZSByZXF1ZXN0IGluIGJlbGllZgoKLy9JZiB0aGVyZSBpcyByZXF1ZXN0IG5lZWQgdG8gYmUgYXVkaXQgYW5kIHRoZSByZXF1ZXN0IGJlIHJlamVjdGVkLCBnaXZlIHJlamVjdGlvbgorIWp1ZGdlOiBuZWVkX2F1dChEYXRhc2V0LFNlbmRlcixSZWNlcGllbnQsUHVycG9zZSk8LQoJLnByaW50KCJUaGlzIHJlcXVlc3QgaXMgbm9uLWNvbXBsaWFudC4iKTsgCgkhcmVqZWN0aW9uOwoJcmVqZWN0aW9uOyAvL2dpdmUgcmVqZWN0aW9uCgktbmVlZF9hdXQoRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpLi8vIGRlbGV0ZSB0aGUgcmVxdWVzdCBpbiBiZWxpZWYKCQovL0lmIHRoZXJlIGlzIG5vIHBlbmRpbmcgcmVxdWVzdAorIWp1ZGdlIDwtIAoJLnByaW50KCJObyBwZW5kaW5nIHJlcXVlc3QuIik7Cgl3YWl0aW5nLgoKKyFzaWduYXR1cmUKPC0gLnByaW50KCJHaXZlIHRoZSBzaWduYXR1cmUuIikuCgorIXJlamVjdGlvbgo8LSAucHJpbnQoIkdpdmUgdGhlIHJlamVjdGlvbi4iKS4KCgo=",
	"Auditor_VMCA": "cG9saWN5MihwYXJraW5nMSwgb21jLCB2bWNhLCB0cmFmZmljX2RpdmVyc2lvbiwgZW1lcmdlbmN5KS4KCnNpZ25hdHVyZShEYXRhc2V0LFNlbmRlcixSZWNlcGllbnQsUHVycG9zZSkgOi0gfm5vcm1hbF9jb25kaXRpb24gJiBwb2xpY3kxKEQsUyxSLFB1cixFbnYpICYgRCA9PSBEYXRhc2V0ICYgUyA9PSBTZW5kZXIgJiBSID09IFJlY2VwaWVudCAmIFB1ciA9PSBQdXJwb3NlLgoKLy9yZWplY3Rpb24oRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpIDotIHBvbGljeShELFMsUixQdXIpICYgKEQgXD09IERhdGFzZXQgfCBTIFw9PSBTZW5kZXIgfCBSIFw9PSBSZWNlcGllbnQgfCBQdXIgXD09IFB1cnBvc2UpLgoKK25vcm1hbF9jb25kaXRpb246dHJ1ZSA8LQoJIXBlcmNlcHRfZW52aXJvbm1ybnQuCgovL1BlcmNlcHQgdGhlIGVudmlyb25tZW50LCB1cGRhdGUgaXQncyBiZWxpZWYgYWJvdXQgZW52aXJvbm1lbnQKLy8rbmVlZF9hdXQoRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpOnRydWUgPC0KCS8vIXBlcmNlcHRfZW52aXJvbm1ybnQuCgorfm5vcm1hbF9jb25kaXRpb246dHJ1ZSA8LQoJIXBlcmNlcHRfZW52aXJvbm1ybnQuCgkKKyFwZXJjZXB0X2Vudmlyb25tcm50IDogfm5vcm1hbF9jb25kaXRpb24gPC0gCgkucHJpbnQoIk5vdyBpcyB1bmRlciBlbWVyZ2VuY3kgY29uZGl0aW9uIik7CgkhanVkZ2UuIC8vIEp1ZGdlIHRoZSByZXF1ZXN0CgorIXBlcmNlcHRfZW52aXJvbm1ybnQgOiBub3JtYWxfY29uZGl0aW9uIDwtCgkucHJpbnQoIk5vdyBpcyB1bmRlciBub3JtYWwgY29uZGl0aW9uIik7CgkhanVkZ2UuIC8vIEp1ZGdlIHRoZSByZXF1ZXN0CgovL0lmIHRoZXJlIGlzIHJlcXVlc3QgbmVlZCB0byBiZSBhdWRpdCBhbmQgdGhlIHJlcXVlc3QgYmUgYXV0aG9yaXplZCwgZ2l2ZSBzaWduaXR1cmUKKyFqdWRnZTogbmVlZF9hdXQoRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpICYgc2lnbmF0dXJlKERhdGFzZXQsU2VuZGVyLFJlY2VwaWVudCxQdXJwb3NlKTwtCgkucHJpbnQoIlRoaXMgcmVxdWVzdCBpcyBjb21wbGlhbnQuIik7Cgkhc2lnbmF0dXJlOwoJc2lnbmF0dXJlOyAvL2dpdmUgc2lnbml0dXJlCgkrc2lnbmVkKERhdGFzZXQsU2VuZGVyLFJlY2VwaWVudCxQdXJwb3NlKTsgLy8gbG9nOiB3aGljaCByZXF1ZXN0IGhhcyBiZWVuIHNpZ25lZAoJLW5lZWRfYXV0KERhdGFzZXQsU2VuZGVyLFJlY2VwaWVudCxQdXJwb3NlKS4gLy8gZGVsZXRlIHRoZSByZXF1ZXN0IGluIGJlbGllZgoKLy9JZiB0aGVyZSBpcyByZXF1ZXN0IG5lZWQgdG8gYmUgYXVkaXQgYW5kIHRoZSByZXF1ZXN0IGJlIHJlamVjdGVkLCBnaXZlIHJlamVjdGlvbgorIWp1ZGdlOiBuZWVkX2F1dChEYXRhc2V0LFNlbmRlcixSZWNlcGllbnQsUHVycG9zZSk8LQoJLnByaW50KCJUaGlzIHJlcXVlc3QgaXMgbm9uLWNvbXBsaWFudC4iKTsgCgkhcmVqZWN0aW9uOwoJcmVqZWN0aW9uOyAvL2dpdmUgcmVqZWN0aW9uCgktbmVlZF9hdXQoRGF0YXNldCxTZW5kZXIsUmVjZXBpZW50LFB1cnBvc2UpLi8vIGRlbGV0ZSB0aGUgcmVxdWVzdCBpbiBiZWxpZWYKCQovL0lmIHRoZXJlIGlzIG5vIHBlbmRpbmcgcmVxdWVzdAorIWp1ZGdlIDwtIAoJLnByaW50KCJObyBwZW5kaW5nIHJlcXVlc3QuIik7Cgl3YWl0aW5nLgoKKyFzaWduYXR1cmUKPC0gLnByaW50KCJHaXZlIHRoZSBzaWduYXR1cmUuIikuCgorIXJlamVjdGlvbgo8LSAucHJpbnQoIkdpdmUgdGhlIHJlamVjdGlvbi4iKS4KCgo="
}

planners = {
	"Planner_VMCA":"bWUuYWRkcmVzcyA9ICJteVB1YmxpY0tleSIKbWUucHJpdmF0ZSA9ICJteVByaXZhdGVLZXkiCgoKCnNlbnNvcjAwMS5lbWVyZ2VuY3kgPT0gdHJ1ZToKCXRva2VuMSA9IGF1ZGl0b3IxLnNpZ25hdHVyZShQQVJLSU5HMV9EQVRBLCBPTUMsIFZNQ0EsIFRSQUZGSUNfRElWRVJTSU9OKQoJdG9rZW4yID0gYXVkaXRvcjIuc2lnbmF0dXJlKFBBUktJTkcxX0RBVEEsIE9NQywgVk1DQSwgVFJBRkZJQ19ESVZFUlNJT04pCgp0b2tlbjEgJiYgdG9rZW4yOgoJcmVzdWx0ID0gZGF0YTEuc2VuZChidWNrZXQyLCBbdG9rZW4xLCB0b2tlbjJdKQoKcmVzdWx0OgoJcHJpbnQoIm9rIikKCiFyZXN1bHQ6CglwcmludChyZXN1bHQuc3RhdHVzKQo="
}

function decode64(s) {
	return new Buffer(s, 'base64').toString('ascii');
}
function encode64(s) {
	return Buffer.from(s).toString('base64')
}

let channel = null

async function initAmqp(config) {
	try {
		const conn = await amqp.connect('amqp://' + config.login + ":" + config.password + "@" + config.host)
		channel = await conn.createChannel()
		amqpChannel = channel
		channel.assertExchange(config.ex, 'topic', {durable:false})
		console.log("Using amqp host: ", amqpHost)
		console.log("Connected to amqp.")
		
		if(myAddress) {
			const rk = myAddress + '.#'
			const r = await channel.assertQueue('', {exclusive: true})
			const q = await channel.bindQueue(r.queue, config.ex, rk)
			channel.consume(r.queue, handler, {noAck: true})
		} else {
			log("Skip queue consumer.")
		}

	} catch(err) {
		console.log(err)
	}
}
initAmqp(config)

async function handler(msg) {
    const rk = msg.fields.routingKey
	const data = msg.content.toString()
	console.log("message> ", data)
	sockets.forEach(s => {
		  if(s.connected){
			s.emit('update', data) 
		  } else {
			console.log('socket not connected')
		  }
	})
}

io.on('connection', function(socket) {
    console.log('Client connected...');
	sockets.push(socket)
	domains.forEach(d => {
		d.type = "domain"
		d.state = "INIT"
		socket.emit('update', JSON.stringify(d))

	})
	Object.keys(planners).forEach(k => {
		p = planners[k]
		const d = {
			type: 'planner',
			state: 'PLANNER_UPDATE',
			address: k,
			body: p
		}
		socket.emit('update', JSON.stringify(d))
	})
	Object.keys(policies).forEach(k => {
		p = policies[k]
		const d = {
			type: 'policy',
			state: 'POLICY_UPDATE',
			address: k,
			body: p
		}
		socket.emit('update', JSON.stringify(d))
	})
	
	socket.on('ready', function(d) {
		//const topic = ns + '/ui/ready'
		//console.log("sending ", topic)
		//client.publish(topic, '{}')
	})

	socket.on('proxy', function(d) {
		console.log("PROXY: ", d)
		const topic = d.topic
		const b64 = d.base64
		const payload = (b64) ? encode64(JSON.stringify(d.payload)) : JSON.stringify(d.payload)
		console.log("sending proxy: ", d.topic)
		channel.publish("dex01", topic, Buffer.from(payload));
		//client.publish(topic, payload)
	})
})

server.listen(port);
