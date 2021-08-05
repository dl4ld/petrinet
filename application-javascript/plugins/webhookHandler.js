const jwt = require('jsonwebtoken');
const https = require('https');

const type = "nl.dl4ld.webhook";


function callWebhook(ctx, uri, headers, tokenPayload, body) {
        console.log(`${GREEN}--> Calling  webhook: ${uri}`);
        // Get user wallet keys to generate jwt
        const keys = ctx.gateway.identity.credentials;
        const jwToken = createJWT(keys, tokenPayload);
        verifyJWT(keys, jwToken).then(token => {
                console.log("VERIFY: ", token);
        })
        const uriParts = url.parse(uri);
        console.log(uriParts);
        const options = {
                method: "POST",
                hostname: uriParts.hostname,
                path: uriParts.path,
                headers: {
                        'x-access-token': jwToken
                }
        }
        const req = https.request(options, res => {
                console.log(`${GREEN}*** statusCode: ${res.statusCode}`)
                res.on('data', d => {
                        console.log(d.toString('utf-8'));
                });
        });
        req.write(JSON.stringify(body));
        req.end();
        console.log(`${GREEN}<-- Finished calling webhook: ${uri}`);
}

function handler(ctx, event) {
        try {
                const asset = JSON.parse(event.payload.toString('utf8'));
		const eventTransaction = event.getTransactionEvent();
		callWebhook(ctx, asset.action.uri, {}, { transationId: eventTransaction.transactionId, type: "event", user: ctx.userId, org: ctx.orgMSP }, asset)
        } catch (eventError) {
                console.log(`${RED}<-- Failed: Event handler - ${eventError}${RESET}`);
        }
}

module.exports = function(moduleHolder) {
	moduleHolder[type] = handler
	console.log("Loaded event handler: " + type)
}

