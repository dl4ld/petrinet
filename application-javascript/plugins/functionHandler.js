const mqtt = require('mqtt');
const jwt = require('jsonwebtoken');
const type = "nl.dl4ld.function";
const host = "172.20.0.2"
let client;

function createJWT(keys, payload) {
        const p = keys.certificate;
        const k = keys.privateKey;
        const jwToken = jwt.sign({
                payload: payload
        }, k, { algorithm: 'RS256'})

        return jwToken;
}

function verifyJWT(keys, token) {
        const p = keys.certificate;
        const k = keys.privateKey;
        return new Promise((resolve, reject) => {
                jwt.verify(token, p, function(err, decoded) {
                        if(err) {
                                reject(err);
                        }
                        resolve(decoded);
                });
        });
}
const f = {
	alert: function(ctx, args, inputTokens) {
		return new Promise((resolve, reject) => {
			const dataToken = inputTokens.filter(t => t.type == 'DATA');
			console.log("called alert!");
			console.log(JSON.stringify(inputTokens));
			console.log("data: ", dataToken[0].data);
			resolve(dataToken[0].data);
		})
	},
	reset: function(ctx, args, inputTokens) {
		return new Promise((resolve, reject) => {
			console.log("reset done!");
			resolve({});
		})
	},
	docker: function(ctx, args, inputTokens) {
		const keys = ctx.gateway.identity.credentials;
		return new Promise((resolve, reject) => {
			const dataToken = inputTokens.filter(t => {
				return (t.type == "DATA")
			})
			const params = JSON.parse(args);

			const msg = {
				container: params.name,
				cmd: params.cmd,
				cmdParams: dataToken[0].data
			}

			const jwt = createJWT(keys, msg)

			console.log(`[DOCKER] called cmd: ${params.cmd} on container: ${params.name}!`);
			//client.publish(params.name, JSON.stringify(msg), { qos:0, retain: false}, (error) => {
			client.publish(params.name, jwt, { qos:0, retain: false}, (error) => {
				if(error) {
					reject(error)
				} else {
					resolve(msg);
				}
			})
		})
	},
	done: function(ctx, args, inputTokens){
		return new Promise((resolve, reject) => {
			console.log("called done!");
			resolve({"done":""});
		})
	}
}

function handler(ctx, event) {
        try {
                const asset = JSON.parse(event.payload.toString('utf8'));
		//const eventTransaction = event.getTransactionEvent();
		const functionName = asset.action.functionName;
		const inputTokens = asset.inputTokens
		return f[functionName](ctx, asset.action.params, inputTokens)		
		//return callWebhook(ctx, asset.action.uri, {}, { transactionId: eventTransaction.transactionId, type: "event", user: ctx.userId, org: ctx.orgMSP }, asset)
        } catch (eventError) {
		throw new Error(eventError)
        }
}

module.exports = function(moduleHolder) {
	moduleHolder[type] = handler
	const url = `mqtt://${host}`
	client = mqtt.connect(url);
	console.log("Loaded event handler: " + type)
}

