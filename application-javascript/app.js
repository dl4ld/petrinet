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
const commandLineArgs = require('command-line-args');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../test-application/javascript/CAUtil.js');
const AppUtils = require('../../test-application/javascript/AppUtil.js');

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
	{ name: 'plugins', type: String }
]

const options = commandLineArgs(optionDefinitions)

const channelName = options.channel || 'mychannel';
const chaincodeName = options.ccn;
const orgNumber = options['org-number'];
const userId = options.user || 'appUser1';
const org = 'org' + orgNumber;
const orgMSP = 'Org' + orgNumber + 'MSP';
const buildCCPOrg = (options['org-number'] == 1) ? AppUtils.buildCCPOrg1 : AppUtils.buildCCPOrg2
const buildWallet = AppUtils.buildWallet;
const assets = require(options['net-config']);
const moduleHolder = {};
const pluginDir = options.plugins || './plugins';

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


		return gatewayOrg;
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

async function createAndMoveToken(ctx, netId, placeId) {
	const tokenId = 'T' + (Math.floor(Math.random() * 99) + 1);
	//create
	try {
		const assetKey = tokenId;
		console.log(`${GREEN}--> Submit Transaction: CreateToken, ${assetKey}`);
		const transaction = ctx.contract.createTransaction('CreateToken');
		const resultBuffer = await transaction.submit(assetKey, {});
		const asset = resultBuffer.toString('utf8');
		console.log(`${GREEN}<-- Submit CreateToken Result: committed, asset ${assetKey}${asset}${RESET}`);
	} catch (createError) {
		console.log(`${RED}<-- Submit Failed: CreateToken - ${createError}${RESET}`);
	}
	//move
	try {
		console.log(`${GREEN}--> Submit Transaction: PutToken`);
		const transaction = ctx.contract.createTransaction('PutToken');
		const resultBuffer = await transaction.submit(tokenId, netId, placeId);
		const asset = resultBuffer.toString('utf8');
		console.log(`${GREEN}<-- Submit PutToken Result: committed, asset ${asset}`);
	} catch (createError) {
		console.log(`${RED}<-- Submit Failed: PutToken - ${createError}${RESET}`);
	}
}

async function handleNewNet(ctx, event) {
	const net = JSON.parse(event.payload.toString('utf8'));
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

function eventHandler(ctx, event) {
	try {
		const asset = JSON.parse(event.payload.toString('utf8'));
		switch  (event.eventName) {
			case "NewNet":
				handleNewNet(ctx, event);
				break;
			case "Fire":
				const eventTransaction = event.getTransactionEvent();
				if(asset.owner == orgMSP) {
					const handler = moduleHolder[asset.action.type]
					if(handler) {
						console.log(`${GREEN}--> Calling transition handler for ${asset.action.type}${RESET}`);
						handler(ctx, event)
							.then(()=>{
								console.log(`${GREEN}<-- Finished transition handler for ${asset.action.type}${RESET}`);
								asset.outputs.forEach(o => {
									createAndMoveToken(ctx, asset.net, o.id);
								});
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

async function main() {
	console.log(`${BLUE} **** START ****${RESET}`);
	let network1Org;
	let contract1Org;
	let listener;
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
			const context = {
				gateway: gateway1Org,
				network: network1Org,
				contract: contract1Org,
				userId: userId,
				orgMSP: orgMSP
			}
			
			// Create place assets
			const places = assets.places.map(async p => {
				try {
					const assetKey = p.id;
					console.log(`${GREEN}--> Submit Transaction: CreatePlace, ${assetKey}`);
					const transaction = contract1Org.createTransaction('CreatePlace');
					const resultBuffer = await transaction.submit(assetKey);
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
					const resultBuffer = await transaction.submit(assetKey, JSON.stringify(t.color));
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
				const nets = assets.nets.map(async n => {
					try {

						const assetKey = n.id;
						if(n.admin != orgMSP) {
							return
						}
						console.log(`${GREEN}--> Submit Net: CreateNet, ${assetKey}`);
						const transaction = contract1Org.createTransaction('CreateNet');
						const resultBuffer = await transaction.submit(assetKey, JSON.stringify(n.arcs));
						const asset = resultBuffer.toString('utf8');
						console.log(`${GREEN}<-- Submit CreateNet Result: committed, asset ${assetKey}${asset}${RESET}`);
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

	await block();
}
main();
