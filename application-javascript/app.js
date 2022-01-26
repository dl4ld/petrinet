'use strict';

// use this to set logging, must be set before the require('fabric-network');
process.env.HFC_LOGGING = '{"debug": "./debug.log"}';

const { Gateway, Wallets } = require('fabric-network');
const EventStrategies = require('fabric-network/lib/impl/event/defaulteventhandlerstrategies');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const jwt = require('jsonwebtoken');
const https = require('https');
const url = require('url');
const fs = require('fs');
const x509 = require('x509');
const async = require('async');
const commandLineArgs = require('command-line-args');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../test-application3/javascript/CAUtil.js');
const AppUtils = require('../../test-application3/javascript/AppUtil.js');


const express = require('express');
const app = express();
const http = require('http')
const bodyParser = require('body-parser');
const socket = require('socket.io');
const events = require('events');
const amqp = require('amqplib');
const eventEmitter = new events.EventEmitter();

const RED = '\x1b[31m\n';
const GREEN = '\x1b[32m\n';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

const optionDefinitions = [
	{ name: 'org-number', type: Number },
	{ name: 'ccn', type: String },
	{ name: 'channel', type: String },
	{ name: 'net-config', type: String },
	{ name: 'user', type: String },
	{ name: 'plugins', type: String },
	{ name: 'port', alias: 'p', type: String },
	{ name: 'https', type: Boolean },
	{ name: 'privkey', type: String },
	{ name: 'cert', type: String },
	{ name: 'amqp', alias: 'm', type: String },
	{ name: 'config', alias: 'c', type: String }
]

const options = commandLineArgs(optionDefinitions)

const channelName = options.channel || 'mychannel';
const chaincodeName = options.ccn;
const orgNumber = options['org-number'];
const userId = options.user || 'appUser1';
const org = 'org' + orgNumber;
const orgMSP = 'Org' + orgNumber + 'MSP';
const buildWallet = AppUtils.buildWallet;
const assets = require(options['net-config']);
const moduleHolder = {};
const pluginDir = options.plugins || './plugins';
let buildCCPOrg

if(options['org-number'] == 1) buildCCPOrg = AppUtils.buildCCPOrg1
if(options['org-number'] == 2) buildCCPOrg = AppUtils.buildCCPOrg2
if(options['org-number'] == 3) buildCCPOrg = AppUtils.buildCCPOrg3


/**
 * Perform a sleep -- asynchronous wait
 * @param ms the time in milliseconds to sleep for
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function block() {
	sleep(30000).then(() => block())
}

function decode64(s) {
	return new Buffer(s, 'base64').toString('ascii');
}

function encode64(s) {
	return Buffer.from(s).toString('base64')
}


function getKeys(walletOrg1, Org1UserId) {
	const fileName = walletOrg1.store.storePath + '/' + Org1UserId + '.id';

	const fileData = fs.readFileSync(fileName, 'utf-8')
	const data = JSON.parse(fileData);
	const pub = data.credentials.certificate
	const priv = data.credentials.privateKey

}

function loadModules(dir) {
    fs.lstat(dir, function(err, stat) {
        if (stat.isDirectory()) {
            // we have a directory: do a tree walk
            fs.readdir(dir, function(err, files) {
                var f, l = files.length;
                for (var i = 0; i < l; i++) {
                    f = path.join('./', dir, files[i]);
                    loadModules(f);
                }
            });
        } else {
	    if(path.extname(dir) != '.js') {
		    return
	    }
            // we have a file: load it
            require('./' + dir)(moduleHolder);
        }
    });
}

let channel = null
const queue = async.queue(function(task, cb) {
	console.log("Busy with " + task.name);
	task.f.apply(null, task.params)
	.then(result => {
		cb(null, result)
	})
	.catch(err => {
		cb(err, null)
	})

}, 1);

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

//initAmqp(config)

async function initGatewayForOrg(useCommitEvents) {
	console.log(`${GREEN}--> Fabric client user & Gateway init: Using Org1 identity to Org1 Peer${RESET}`);
	// build an in memory object with the network configuration (also known as a connection profile)
	const ccpOrg = buildCCPOrg();

	// build an instance of the fabric ca services client based on
	// the information in the network configuration
	const caOrgClient = buildCAClient(FabricCAServices, ccpOrg, 'ca.' + org +'.example.com');

	// setup the wallet to cache the credentials of the application user, on the app server locally
	const walletPathOrg = path.join(__dirname, 'wallet_' + org, org);
	const walletOrg = await buildWallet(Wallets, walletPathOrg);

	// in a real application this would be done on an administrative flow, and only once
	// stores admin identity in local wallet, if needed
	await enrollAdmin(caOrgClient, walletOrg, org);
	// register & enroll application user with CA, which is used as client identify to make chaincode calls
	// and stores app user identity in local wallet
	// In a real application this would be done only when a new user was required to be added
	// and would be part of an administrative flow
	await registerAndEnrollUser(caOrgClient, walletOrg, orgMSP, userId, org + '.department1');

	try {
		// Create a new gateway for connecting to Org's peer node.
		const gatewayOrg = new Gateway();

		if (useCommitEvents) {
			await gatewayOrg.connect(ccpOrg, {
				wallet: walletOrg,
				identity: userId,
				discovery: { enabled: true, asLocalhost: true }
			});
		} else {
			await gatewayOrg.connect(ccpOrg, {
				wallet: walletOrg,
				identity: userId,
				discovery: { enabled: true, asLocalhost: true },
				eventHandlerOptions: EventStrategies.NONE
			});
		}


		return gatewayOrg;;
	} catch (error) {
		console.error(`Error in connecting to gateway for Org: ${error}`);
		process.exit(1);
	}
}

function checkAsset(org, resultBuffer, color, size, owner, appraisedValue, price) {
	console.log(`${GREEN}<-- Query results from ${org}${RESET}`);

	let asset;
	if (resultBuffer) {
		asset = JSON.parse(resultBuffer.toString('utf8'));
	} else {
		console.log(`${RED}*** Failed to read asset${RESET}`);
	}
	console.log(`*** verify asset ${asset.ID}`);

	if (asset) {
		if (asset.Color === color) {
			console.log(`*** asset ${asset.ID} has color ${asset.Color}`);
		} else {
			console.log(`${RED}*** asset ${asset.ID} has color of ${asset.Color}${RESET}`);
		}
		if (asset.Size === size) {
			console.log(`*** asset ${asset.ID} has size ${asset.Size}`);
		} else {
			console.log(`${RED}*** Failed size check from ${org} - asset ${asset.ID} has size of ${asset.Size}${RESET}`);
		}
		if (asset.Owner === owner) {
			console.log(`*** asset ${asset.ID} owned by ${asset.Owner}`);
		} else {
			console.log(`${RED}*** Failed owner check from ${org} - asset ${asset.ID} owned by ${asset.Owner}${RESET}`);
		}
		if (asset.AppraisedValue === appraisedValue) {
			console.log(`*** asset ${asset.ID} has appraised value ${asset.AppraisedValue}`);
		} else {
			console.log(`${RED}*** Failed appraised value check from ${org} - asset ${asset.ID} has appraised value of ${asset.AppraisedValue}${RESET}`);
		}
		if (price) {
			if (asset.asset_properties && asset.asset_properties.Price === price) {
				console.log(`*** asset ${asset.ID} has price ${asset.asset_properties.Price}`);
			} else {
				console.log(`${RED}*** Failed price check from ${org} - asset ${asset.ID} has price of ${asset.asset_properties.Price}${RESET}`);
			}
		}
	}
}

function showTransactionData(transactionData) {
	const creator = transactionData.actions[0].header.creator;
	console.log(`    - submitted by: ${creator.mspid}-${creator.id_bytes.toString('hex')}`);
	for (const endorsement of transactionData.actions[0].payload.action.endorsements) {
		console.log(`    - endorsed by: ${endorsement.endorser.mspid}-${endorsement.endorser.id_bytes.toString('hex')}`);
	}
	const chaincode = transactionData.actions[0].payload.chaincode_proposal_payload.input.chaincode_spec;
	console.log(`    - chaincode:${chaincode.chaincode_id.name}`);
	console.log(`    - function:${chaincode.input.args[0].toString()}`);
	for (let x = 1; x < chaincode.input.args.length; x++) {
		console.log(`    - arg:${chaincode.input.args[x].toString()}`);
	}
}

async function completeTransition(ctx, netId, transitionId, tokenIds, outputData) {
	try {
		console.log(`${GREEN}--> Submit Transaction: CompleteTransition, ${transitionId}, ${netId} with output tokens ${tokenIds}`);
		//const transaction = ctx.contract.createTransaction('CompleteTransition');
		//const resultBuffer = await transaction.submit(netId, transitionId);
		//const result = resultBuffer.toString('utf8');
		const result = await submit(ctx, 'CompleteTransition', netId, transitionId, JSON.stringify(tokenIds), JSON.stringify(outputData));
		console.log(`${GREEN}<-- Submit CompleteTransaction Result: committed ${JSON.stringify(result)}`);
	} catch (createError) {
		console.log(`${RED}<-- Submit Failed: CompleteTransition - ${createError}${RESET}`);
	}
}

async function createAndMoveToken(ctx, netId, placeId) {
	const tokenId = 'TK' + (Math.floor(Math.random() * 99) + 1);
	//create
	try {
		const assetKey = tokenId;
		console.log(`${GREEN}--> Submit Transaction: CreateToken, ${assetKey}`);
		//const transaction = ctx.contract.createTransaction('CreateToken');
		//const resultBuffer = await transaction.submit(assetKey, {});
		//const asset = resultBuffer.toString('utf8');
		const asset = await submit(ctx, 'CreateToken', assetKey, "AUTH", null, null);
		console.log(`${GREEN}<-- Submit CreateToken Result: committed, asset ${assetKey}${asset}${RESET}`);
	} catch (createError) {
		console.log(`${RED}<-- Submit Failed: CreateToken - ${createError}${RESET}`);
	}
	//move
	async.retry({times:50, interval: 5000}, function(cb){
		console.log(`${GREEN}--> Submit Transaction: PutToken`);
		const transaction = ctx.contract.createTransaction('PutToken');
		transaction.submit(tokenId, netId, placeId)
			.then(resultBuffer => {
				const asset = resultBuffer.toString('utf8');
				console.log(`${GREEN}<-- Submit PutToken Result: committed, asset ${asset}`);
				//eventEmmiter.emit('PutToken', {
				//	net: netId,
				//	place: placeId,
				//	token: tokenId
				//})
				cb(null, asset);
			})
			.catch(err => {
				console.log(`${RED}<-- Submit Failed: PutToken - ${err}${RESET}`);
				cb(err, null);
			});
	})
	return {
		net: netId,
		place: placeId,
		token: tokenId
	}
}

async function handleNewNet(ctx, event) {
	const net = JSON.parse(event.payload.toString('utf8'));
	if(!net.domains[orgMSP]) {
		console.log(`${BLUE} Nothing to do with net ${net.id}`);
		return
	}
	if(net.domains[orgMSP]["status"] == "NotAccepted") {
		// check if we should accept
		// TODO
		// accept net
		try {
			console.log(`${GREEN}--> Submit Transaction: AcceptNet, ${net.id}`);
			const transaction = ctx.contract.createTransaction('AcceptNet');
			const resultBuffer = await transaction.submit(net.id);
			const acceptedNet = JSON.parse(resultBuffer.toString('utf8'));
			console.log(acceptedNet);
			console.log(`${GREEN}<-- Submit AcceptNet Result: committed, asset ${net.id}${RESET}`);
		} catch (createError) {
			console.log(`${RED}<-- Submit Failed: AcceptNet - ${createError}${RESET}`);
		}

	}
}

function submit(ctx, name, ...args) {
	const transaction = ctx.contract.createTransaction(name);
	return async.retry({times:50, interval: 5000}, function(cb){
		transaction.submit(...args)
		.then(response => {
			cb(null, JSON.parse(response.toString('utf8')));
		})
		.catch(err => {
			console.log(`${RED}<-- Submit Failed: ${name} - ${err}${RESET}`);
			cb(err, null);
		})
	});
}

function eventHandler(ctx, event) {
	try {
		const asset = JSON.parse(event.payload.toString('utf8'));
		switch  (event.eventName) {
			case "PutRemoveTokens":
				console.log(asset);
				asset.forEach(e => {
					console.log(e)
					if(e.type == "Fire") {
						const fireEvent = {
							eventName: "Fire",
							payload: JSON.stringify(e.data)
						}
						eventHandler(ctx, fireEvent)
					} else {
						eventEmitter.emit(e.type, e.data)
					}
				});
				break;
			case "PutToken":
				eventEmitter.emit('PutToken', asset);
				break;
			case "RemoveToken":
				eventEmitter.emit('RemoveToken', asset);
				break;
			case "NewNet":
				handleNewNet(ctx, event);
				break;
			case "Fire":
				// TODO serialize this qith queue
				//const eventTransaction = event.getTransactionEvent();
				if(asset.owner == orgMSP) {
					const handler = moduleHolder[asset.action.type]
					if(handler) {
						console.log(`${GREEN}--> Calling transition handler for ${asset.action.type}${RESET}`);
						handler(ctx, event)
							.then(async (outputData)=>{
								console.log(`${GREEN}<-- Finished transition handler for ${asset.action.type}${RESET}`);
								const tokenIds = asset.outputs.map(o => {
									return 'TK' + (Math.floor(Math.random() * 999) + 1);
								})
								console.log("outputData: ", outputData);
								queue.push({
									name: `completeTransition ${asset.id}`,
									f: completeTransition,
									params: [ctx, asset.net, asset.id, tokenIds, outputData]
								}, (err, result) => {
									if(err) {
										console.log(err);
									}
								})
								//await completeTransition(ctx, asset.net, asset.id, tokenIds);
								//asset.outputs.forEach(o => {
								//	const result = createAndMoveToken(ctx, asset.net, o.id);
								//});
							})
							.catch(e => {
								throw new Error(e);
							})
					} else {
					  	throw new Error(`Handler for ${asset.action.type} not found!`);
					}
				}
				break;
		}

	} catch (eventError) {
		console.log(`${RED}<-- Failed: Event handler - ${eventError}${RESET}`);
	}
}

async function startHttpServer() {
}

async function main() {
	console.log(`${BLUE} **** START ****${RESET}`);
	let network1Org;
	let contract1Org;
	let listener;
	let context;
	try {
		// Load transition handlers
		loadModules(pluginDir);
		// Fabric client init: Using Org1 identity to Org1 Peer
		const gateway1Org = await initGatewayForOrg(true); // transaction handling uses commit events
		const gateway2Org = await initGatewayForOrg();

		try {
			network1Org = await gateway1Org.getNetwork(channelName);
			contract1Org = network1Org.getContract(chaincodeName);
			let listener;
			context = {

				gateway: gateway1Org,
				network: network1Org,
				contract: contract1Org,
				userId: userId,
				orgMSP: orgMSP
			}


			// temp
			/*const keys = context.gateway.identity.credentials;
			const jsonToken = {
				hello: "world"
			}

			console.log(keys.certificate)

			const jwToken = jwt.sign({
                		payload: jsonToken
        		}, keys.privateKey, { algorithm: 'RS256'})

			console.log(jwToken);

			const transaction = contract1Org.createTransaction('GetIdentity');
			const resultBuffer = await transaction.submit(jwToken);
			const asset = resultBuffer.toString('utf8');
			console.log(asset);
			const kkk = context.gateway.identity.credentials.certificate
			console.log(kkk);

			process.exit(0);*/

			// end temp


			
			// Create place assets
			const places = assets.places.map(async p => {
				try {
					const assetKey = p.id;
					console.log(`${GREEN}--> Submit Transaction: CreatePlace, ${assetKey}`);
					const transaction = contract1Org.createTransaction('CreatePlace');
					const resultBuffer = await transaction.submit(assetKey, p.type, JSON.stringify(p));
					const asset = resultBuffer.toString('utf8');
					console.log(`${GREEN}<-- Submit CreatePlace Result: committed, asset ${assetKey}${asset}${RESET}`);
				} catch (createError) {
					console.log(`${RED}<-- Submit Failed: CreatePlace - ${createError}${RESET}`);
				}
			});

			// Create token assets
			const tokens = assets.tokens.map(async t => {
				try {
					const assetKey = t.id;
					console.log(`${GREEN}--> Submit Transaction: CreateToken, ${assetKey}`);
					const transaction = contract1Org.createTransaction('CreateToken');
					//const resultBuffer = await transaction.submit(assetKey, t.type, JSON.stringify(t.data), t.owner);
					const resultBuffer = await transaction.submit(assetKey, t.type, t.data, t.owner);
					const asset = resultBuffer.toString('utf8');
					console.log(`${GREEN}<-- Submit CreateToken Result: committed, asset ${assetKey}${asset}${RESET}`);
				} catch (createError) {
					console.log(`${RED}<-- Submit Failed: CreateToken - ${createError}${RESET}`);
				}
			});

			// Create transition assets
			const transitions = assets.transitions.map(async t => {
				try {
					const assetKey = t.id;
					console.log(`${GREEN}--> Submit Transaction: CreateTransition, ${assetKey}`);
					let transaction;
					let resultBuffer;
					let asset;
					if(t.action.type == "nl.dl4ld.function") {
						transaction = contract1Org.createTransaction('CreateFunctionTransition');
						resultBuffer = await transaction.submit(assetKey, t.action.functionName, JSON.stringify(t.action.params));
					}
					if(t.action.type == "nl.dl4ld.webhook"){
						transaction = contract1Org.createTransaction('CreateWebhookTransition');
						resultBuffer = await transaction.submit(assetKey, t.action.webhookURI, "");
					}
					if(t.action.type == "nl.dl4ld.actorAction"){
						transaction = contract1Org.createTransaction('CreateTransition');
						resultBuffer = await transaction.submit(assetKey, t.action.functionURI);
					}

					asset = resultBuffer.toString('utf8');
					console.log(`${GREEN}<-- Submit CreateTransition Result: committed, asset ${assetKey}${asset}${RESET}`);
				} catch (createError) {
					console.log(`${RED}<-- Submit Failed: CreateTransition - ${createError}${RESET}`);
				}
			});

			Promise.all([...places, ...tokens, ...transitions]).then((values) => {
				// Create Petrinet assets
				const nets = assets.nets
					.filter(n => {
						return (!n.disabled && n.admin == orgMSP)
					})
					.map(async n => {
					try {

						const assetKey = n.id;
						//if(n.admin != orgMSP) {
						//	return
						//}
						const details = {
							k: n.config.k
						}
						console.log(`${GREEN}--> Submit Net: CreateNet, ${assetKey} ${JSON.stringify(n)}`);
						const transaction = contract1Org.createTransaction('CreateNet');
						const resultBuffer = await submit(context, 'CreateNet', assetKey, JSON.stringify(n.arcs), JSON.stringify(details));
						const asset = resultBuffer.toString('utf8');
						console.log(`${GREEN}<-- Submit CreateNet Result: committed, asset ${assetKey}${JSON.stringify(asset)}${RESET}`);
					} catch (createError) {
						console.log(`${RED}<-- Submit Failed: CreateNet - ${createError}${RESET}`);
					}
				});

				Promise.all(nets).then(async values => {
					// Run instructions sequentially 
					for(let i = 0; i < assets.instructions.length; i++) {
						const instruction = assets.instructions[i];
						console.log(instruction)
						if(instruction.cmd == "move") {
							const m = instruction;
							try {
								console.log(`${GREEN}--> Submit Transaction: PutToken`);
								const transaction = contract1Org.createTransaction('PutToken');
								const resultBuffer = await transaction.submit(m.token, m.net, m.place);
								const asset = resultBuffer.toString('utf8');
								console.log(`${GREEN}<-- Submit PutToken Result: committed, asset ${asset}`);
							} catch (createError) {
								console.log(`${RED}<-- Submit Failed: PutToken - ${createError}${RESET}`);
								// hack to retry
								i -= 1;
								await sleep(3000);
							}
						}
						if(instruction.cmd == "delete") {
							const d = instruction;
							try {
								console.log(`${GREEN}--> Submit Transaction: DeleteAsset`);
								const transaction = contract1Org.createTransaction('DeleteTransition');
								const resultBuffer = await transaction.submit(d.id);
								const asset = resultBuffer.toString('utf8');
								console.log(`${GREEN}<-- Submit DeleteAsset Result: committed, asset ${asset}`);
							} catch (createError) {
								console.log(`${RED}<-- Submit Failed: DeleteAsset - ${createError}${RESET}`);
							}
						}

					} // for loop
				});
			});

			try {
				console.log(`${BLUE} **** CHAINCODE EVENTS ****${RESET}`);
				listener = async (event) => {
					const asset = JSON.parse(event.payload.toString('utf8'));
					console.log(`${GREEN}<-- Contract Event Received: ${event.eventName} - ${JSON.stringify(asset)}${RESET}`);
					// show the information available with the event
					console.log(`*** Event: ${event.eventName}:${asset.id}`);
					// notice how we have access to the transaction information that produced this chaincode event
					const eventTransaction = event.getTransactionEvent();
					console.log(`*** transaction: ${eventTransaction.transactionId} status:${eventTransaction.status}`);
					showTransactionData(eventTransaction.transactionData);
					// notice how we have access to the full block that contains this transaction
					const eventBlock = eventTransaction.getBlockEvent();
					console.log(`*** block: ${eventBlock.blockNumber.toString()}`);
					// Handle event
					eventHandler(context, event);
				};
				console.log(`${GREEN}--> Start contract event stream to peer in Org${RESET}`);
				await contract1Org.addContractListener(listener);
			} catch (eventError) {
				console.log(`${RED}<-- Failed: Setup contract events - ${eventError}${RESET}`);
			}
			

		} catch (runError) {
			console.error(`Error in transaction: ${runError}`);
			if (runError.stack) {
				console.error(runError.stack);
			}
		}
	} catch (error) {
		console.error(`Error in setup: ${error}`);
		if (error.stack) {
			console.error(error.stack);
		}
		process.exit(1);
	}

	process.on('SIGINT', () => {
		console.log(`${BLUE} **** END ****${RESET}`);
		network1Org.removeBlockListener(listener);
		process.exit(0);
	});

	
	/*setInterval(async () => {
		try {
			console.log(`${GREEN}--> Submit Transaction: GetAllTokens`);
			const transaction = contract1Org.createTransaction('GetAllTokens');
			const resultBuffer = await transaction.submit();
			const tokens = resultBuffer.toString('utf8');
			const JSONTokens = JSON.parse(tokens);
			JSONTokens.forEach(t => {
				console.log("token: ", t);
			})
			console.log(`${GREEN}<-- Submit GetTokens Result: ${tokens}${RESET}`);
		} catch (createError) {
			console.log(`${RED}<-- Submit Failed: CreatePlace - ${createError}${RESET}`);
		}
		
		try {
			console.log(`${GREEN}--> Submit Transaction: GetAllNets`);
			const transaction = contract1Org.createTransaction('GetAllNets');
			const resultBuffer = await transaction.submit();
			const nets = resultBuffer.toString('utf8');
			const JSONTokens = JSON.parse(nets);
			JSONTokens.forEach(n => {
				console.log("net: ", n);
			})
			console.log(`${GREEN}<-- Submit GetTokens Result: ${tokens}${RESET}`);
		} catch (createError) {
			console.log(`${RED}<-- Submit Failed: CreatePlace - ${createError}${RESET}`);
		}

	}, 5000);*/
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

	const port = options.port || 9191
	const myAddress = 'frontend'
	//const amqpHost = config.host || process.env.AMQP_HOST || 'dex-01.lab.uvalight.net'
	const sockets = []

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

	io.on('connection', async function(socket) {
	    console.log('Client connected...');
		sockets.push(socket)
		try {
			// Send identity
			const str = context.gateway.identity.credentials.certificate;
			const cert = x509.parseCert(context.gateway.identity.credentials.certificate);
			socket.emit("identity", JSON.stringify(cert));

			// Get Nets
			console.log(`${GREEN}--> Submit Transaction: GetAllNets`);
			let transaction = contract1Org.createTransaction('GetAllNets');
			let resultBuffer = await transaction.submit();
			const nets = resultBuffer.toString('utf8');
			//const JSONTokens = JSON.parse(nets);
			//JSONTokens.forEach(n => {
			//	console.log("net: ", n);
			//})
			socket.emit('net', nets);
			console.log(`${GREEN}<-- Submit GetAllNets Result: ${nets}${RESET}`);
			
			// Get Transitions
			console.log(`${GREEN}--> Submit Transaction: GetAllTransitions`);
			transaction = contract1Org.createTransaction('GetAllTransitions');
			resultBuffer = await transaction.submit();
			const transitions = resultBuffer.toString('utf8');
			//const JSONTokens = JSON.parse(transitions);
			socket.emit('transitions', transitions);
			console.log(`${GREEN}<-- Submit GetAllTransitions Result: ${transitions}${RESET}`);
			
			// Get Tokens
			console.log(`${GREEN}--> Submit Transaction: GetAllTokens`);
			transaction = contract1Org.createTransaction('GetAllTokens');
			resultBuffer = await transaction.submit();
			const tokens = resultBuffer.toString('utf8');
			//const JSONTokens = JSON.parse(transitions);
			socket.emit('tokens', tokens);
			console.log(`${GREEN}<-- Submit GetAllTokens Result: ${tokens}${RESET}`);
			
			// Get Places
			console.log(`${GREEN}--> Submit Transaction: GetAllPlaces`);
			transaction = contract1Org.createTransaction('GetAllPlaces');
			resultBuffer = await transaction.submit();
			const places = resultBuffer.toString('utf8');
			//const JSONTokens = JSON.parse(transitions);
			socket.emit('places', places);
			console.log(`${GREEN}<-- Submit GetAllPlaces Result: ${places}${RESET}`);

			eventEmitter.on("PutToken", (data) => {
				socket.emit("PutToken", data)
			});
			eventEmitter.on("RemoveToken", (data) => {
				socket.emit("RemoveToken", data)
			});

			socket.on('GetTokens', async () => {
				// Get Tokens
				console.log(`${GREEN}--> Submit Transaction: GetAllTokens`);
				transaction = contract1Org.createTransaction('GetAllTokens');
				resultBuffer = await transaction.submit();
				const tokens = resultBuffer.toString('utf8');
				//const JSONTokens = JSON.parse(transitions);
				socket.emit('tokens', tokens);
				console.log(`${GREEN}<-- Submit GetAllTokens Result: ${tokens}${RESET}`);
			})

			socket.on('PutToken', (data) => {
				console.log(`event PutToken ${JSON.stringify(data)}`);
				let errorMsg = ""

				async.retry({times:1, interval: 5000}, function(cb){
					console.log(`${GREEN}--> Submit Transaction: PutToken`);
					const transaction = contract1Org.createTransaction('PutToken');
					transaction.submit(data.token, data.net, data.place)
						.then(resultBuffer => {
							const asset = resultBuffer.toString('utf8');
							console.log(`${GREEN}<-- Submit PutToken Result: committed, asset ${asset}`);
							cb(null, asset);
						})
						.catch(err => {
							console.log(`${RED}<-- Submit Failed: PutToken - ${err}${RESET}`);
							errorMsg = JSON.stringify(err.message);
							cb(err, null);
						});
				}, function(err, results) {
					if(err) {
						console.log("Giving up retry!", err.message)
						socket.emit("Error", errorMsg)
					}
				})
			});


		} catch (err) {
			console.log(err);
		}
		//domains.forEach(d => {
		//	d.type = "domain"
		//	d.state = "INIT"
		//	socket.emit('update', JSON.stringify(d))

		//})
		//Object.keys(planners).forEach(k => {
		//	p = planners[k]
		//	const d = {
		//		type: 'planner',
		//		state: 'PLANNER_UPDATE',
		//		address: k,
		//		body: p
		//	}
		//	socket.emit('update', JSON.stringify(d))
		//})
		//Object.keys(policies).forEach(k => {
		//	p = policies[k]
		//	const d = {
		//		type: 'policy',
		//		state: 'POLICY_UPDATE',
		//		address: k,
		//		body: p
		//	}
		//	socket.emit('update', JSON.stringify(d))
		//})
		
		socket.on('ready', function(d) {
			//const topic = ns + '/ui/ready'
			//console.log("sending ", topic)
			//client.publish(topic, '{}')
		})

		socket.on('proxy', function(d) {
		//	console.log("PROXY: ", d)
		//	const topic = d.topic
		//	const b64 = d.base64
		//	const payload = (b64) ? encode64(JSON.stringify(d.payload)) : JSON.stringify(d.payload)
		//	console.log("sending proxy: ", d.topic)
		//	channel.publish("dex01", topic, Buffer.from(payload));
		//	//client.publish(topic, payload)
		})
	})

	server.listen(port);
	
}
main();

