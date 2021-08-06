const jwt = require('jsonwebtoken');
const https = require('https');
const url = require('url');

const type = "nl.dl4ld.webhook";


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

function callWebhook(ctx, uri, headers, tokenPayload, body) {
	return new Promise((resolve, reject) => {
		// Get user wallet keys to generate jwt
		const keys = ctx.gateway.identity.credentials;
		const jwToken = createJWT(keys, tokenPayload);
		//verifyJWT(keys, jwToken).then(token => {
		//        console.log("VERIFY: ", token);
		//})
		const uriParts = url.parse(uri);
		const options = {
			method: "POST",
			hostname: uriParts.hostname,
			path: uriParts.path,
			headers: {
				'x-access-token': jwToken
			}
		}
		const req = https.request(options, res => {
			const statusCode = res.statusCode;
			if((statusCode >= 200) && (statusCode < 300)){
				resolve();
				return;
			} else {
				reject(`Webhook failed with code ${statusCode}.`);
			}

			res.on('data', d => {
				//console.log(d.toString('utf-8'));
			});
		});
		req.write(JSON.stringify(body));
		req.end();
	});
}

function handler(ctx, event) {
        try {
                const asset = JSON.parse(event.payload.toString('utf8'));
		const eventTransaction = event.getTransactionEvent();
		return callWebhook(ctx, asset.action.uri, {}, { transationId: eventTransaction.transactionId, type: "event", user: ctx.userId, org: ctx.orgMSP }, asset)
        } catch (eventError) {
		throw new Error(eventError)
        }
}

module.exports = function(moduleHolder) {
	moduleHolder[type] = handler
	console.log("Loaded event handler: " + type)
}

