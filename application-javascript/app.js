'use strict';

// use this to set logging, must be set before the require('fabric-network');
process.env.HFC_LOGGING = '{"debug": "./debug.log"}';

const { Gateway, Wallets } = require('fabric-network');
const EventStrategies = require('fabric-network/lib/impl/event/defaulteventhandlerstrategies');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
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
	{ name: 'assets-file', type: String },
	{ name: 'user', type: String }
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
const assets = require(options['assets-file']);

//const org1 = 'Org1MSP';
//const Org1UserId = 'appUser1';
/**
 * Perform a sleep -- asynchronous wait
 * @param ms the time in milliseconds to sleep for
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

async function main() {
	console.log(`${BLUE} **** START ****${RESET}`);
	try {
		/** ******* Fabric client init: Using Org1 identity to Org1 Peer ******* */
		const gateway1Org = await initGatewayForOrg(true); // transaction handling uses commit events
		const gateway2Org = await initGatewayForOrg();

		try {
			//
			//  - - - - - -  C H A I N C O D E  E V E N T S
			//
			console.log(`${BLUE} **** CHAINCODE EVENTS ****${RESET}`);
			const network1Org = await gateway1Org.getNetwork(channelName);
			const contract1Org = network1Org.getContract(chaincodeName);

			assets.places.forEach(async p => {
				console.log(p)
				try {
					// C R E A T E
					const assetKey = p.id;
					console.log(`${GREEN}--> Submit Transaction: CreatePlace, ${assetKey}`);
					const transaction = contract1Org.createTransaction('CreatePlace');
					const resultBuffer = await transaction.submit(assetKey);
					const asset = JSON.parse(resultBuffer.toString('utf8'));
					console.log(asset);
					console.log(`${GREEN}<-- Submit CreatePlace Result: committed, asset ${assetKey}${RESET}`);
				} catch (createError) {
					console.log(`${RED}<-- Submit Failed: CreatePlace - ${createError}${RESET}`);
				}
			})

			/*try {
				// first create a listener to be notified of chaincode code events
				// coming from the chaincode ID "events"
				listener = async (event) => {
					// The payload of the chaincode event is the value place there by the
					// chaincode. Notice it is a byte data and the application will have
					// to know how to deserialize.
					// In this case we know that the chaincode will always place the asset
					// being worked with as the payload for all events produced.
					const asset = JSON.parse(event.payload.toString('utf8'));
					console.log(asset)
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
				};
				// now start the client side event service and register the listener
				console.log(`${GREEN}--> Start contract event stream to peer in Org1${RESET}`);
				await contract1Org1.addContractListener(listener);
			} catch (eventError) {
				console.log(`${RED}<-- Failed: Setup contract events - ${eventError}${RESET}`);
			}

			try {
				// C R E A T E
				console.log(`${GREEN}--> Submit Transaction: CreatePlace, ${assetKey}`);
				transaction = contract1Org1.createTransaction('CreatePlace');
				const resultBuffer = await transaction.submit(assetKey);
				const asset = JSON.parse(resultBuffer.toString('utf8'));
				console.log(asset);
				console.log(`${GREEN}<-- Submit CreatePlace Result: committed, asset ${assetKey}${RESET}`);
			} catch (createError) {
				console.log(`${RED}<-- Submit Failed: CreatePlace - ${createError}${RESET}`);
			}*/
			/*try {
				// C R E A T E
				console.log(`${GREEN}--> Submit Transaction: CreatePlace, ${assetKey2}`);
				transaction = contract1Org1.createTransaction('CreatePlace');
				const resultBuffer = await transaction.submit(assetKey2);
				const asset = JSON.parse(resultBuffer.toString('utf8'));
				console.log(asset);
				console.log(`${GREEN}<-- Submit CreatePlace Result: committed, asset ${assetKey2}${RESET}`);
			} catch (createError) {
				console.log(`${RED}<-- Submit Failed: CreatePlace - ${createError}${RESET}`);
			}*/
			
			/*try {
				// C R E A T E
				console.log(`${GREEN}--> Submit Transaction: CreateToken, ${assetKey}`);
				transaction = contract1Org1.createTransaction('CreateToken');
				const color = {
					type: 'blue',
					value: 5
				}

				const resultBuffer = await transaction.submit(assetKey, JSON.stringify(color));
				const asset = JSON.parse(resultBuffer.toString('utf8'));
			//	const asset = resultBuffer.toString('utf8');
				console.log(asset);
				console.log(`${GREEN}<-- Submit CreateToken Result: committed, asset ${assetKey}`);
			} catch (createError) {
				console.log(`${RED}<-- Submit Failed: CreateToken - ${createError}${RESET}`);
			}

			/*try {
				// C R E A T E
				console.log(`${GREEN}--> Submit Transaction: CreateTransition, ${assetKey}`);
				transaction = contract1Org1.createTransaction('CreateTransition');
				const functionURI = "YAkJunLY0Pv3AjZHD++blx5PKOYydceseKmejkQqCGA=.f.sayHello"
				const resultBuffer = await transaction.submit(assetKey, functionURI);
				const asset = JSON.parse(resultBuffer.toString('utf8'));
				console.log(asset);
				console.log(`${GREEN}<-- Submit CreateTransition Result: committed, asset ${assetKey}`);
			} catch (createError) {
				console.log(`${RED}<-- Submit Failed: CreateTransition - ${createError}${RESET}`);
			}*/
			
			/*try {
				// C R E A T E
				const net = [
					{ src: {type: 'place',	id: assetKey2}, dst: { type: 'transition', id: assetKey2}},
					{ src: {type: 'transition', id: assetKey2}, dst: { type: 'place', id: assetKey}},

				]
				console.log(`${GREEN}--> Submit Net: CreateNet, ${assetKey}`);
				transaction = contract1Org1.createTransaction('CreateNet');
				const resultBuffer = await transaction.submit(assetKey, JSON.stringify(net));
				const asset = JSON.parse(resultBuffer.toString('utf8'));
				console.log(JSON.stringify(asset));
				console.log(`${GREEN}<-- Submit CreateNet Result: committed, asset ${assetKey}`);
			} catch (createError) {
				console.log(`${RED}<-- Submit Failed: CreateNet - ${createError}${RESET}`);
			}

			try {
				// C R E A T E
				console.log(`${GREEN}--> Submit Transaction: PutToken`);
				transaction = contract1Org1.createTransaction('PutToken');
				const resultBuffer = await transaction.submit(assetKey, assetKey, assetKey2);
				const asset = JSON.parse(resultBuffer.toString('utf8'));
				console.log(asset);
				console.log(`${GREEN}<-- Submit PutToken Result: committed, asset ${assetKey}`);
			} catch (createError) {
				console.log(`${RED}<-- Submit Failed: PutToken - ${createError}${RESET}`);
			}
			/*try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: GetPlace, - ${assetKey}`);
				const resultBuffer = await contract1Org1.evaluateTransaction('GetPlace', assetKey);
				const asset = JSON.parse(resultBuffer.toString('utf8'));
				console.log(asset);
			} catch (readError) {
				console.log(`${RED}<-- Failed: GetPlace - ${readError}${RESET}`);
			}

			/*try {
				// U P D A T E
				console.log(`${GREEN}--> Submit Transaction: UpdateAsset ${assetKey} update appraised value to 200`);
				transaction = contract1Org1.createTransaction('UpdateAsset');
				await transaction.submit(assetKey, 'blue', '10', 'Sam', '200');
				console.log(`${GREEN}<-- Submit UpdateAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (updateError) {
				console.log(`${RED}<-- Failed: UpdateAsset - ${updateError}${RESET}`);
			}
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should now have appraised value of 200${RESET}`);
				const resultBuffer = await contract1Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Sam', '200');
			} catch (readError) {
				console.log(`${RED}<-- Failed: ReadAsset - ${readError}${RESET}`);
			}

			try {
				// T R A N S F E R
				console.log(`${GREEN}--> Submit Transaction: TransferAsset ${assetKey} to Mary`);
				transaction = contract1Org1.createTransaction('TransferAsset');
				await transaction.submit(assetKey, 'Mary');
				console.log(`${GREEN}<-- Submit TransferAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (transferError) {
				console.log(`${RED}<-- Failed: TransferAsset - ${transferError}${RESET}`);
			}
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should now be owned by Mary${RESET}`);
				const resultBuffer = await contract1Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Mary', '200');
			} catch (readError) {
				console.log(`${RED}<-- Failed: ReadAsset - ${readError}${RESET}`);
			}

			try {
				// D E L E T E
				console.log(`${GREEN}--> Submit Transaction: DeleteAsset ${assetKey}`);
				transaction = contract1Org1.createTransaction('DeleteAsset');
				await transaction.submit(assetKey);
				console.log(`${GREEN}<-- Submit DeleteAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (deleteError) {
				console.log(`${RED}<-- Failed: DeleteAsset - ${deleteError}${RESET}`);
				if (deleteError.toString().includes('ENDORSEMENT_POLICY_FAILURE')) {
					console.log(`${RED}Be sure that chaincode was deployed with the endorsement policy "OR('Org1MSP.peer','Org2MSP.peer')"${RESET}`);
				}
			}
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should now be deleted${RESET}`);
				const resultBuffer = await contract1Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Mary', '200');
				console.log(`${RED}<-- Failed: ReadAsset - should not have read this asset${RESET}`);
			} catch (readError) {
				console.log(`${GREEN}<-- Success: ReadAsset - ${readError}${RESET}`);
			}

			// all done with this listener
			contract1Org1.removeContractListener(listener);

			//
			//  - - - - - -  B L O C K  E V E N T S  with  P R I V A T E  D A T A
			//
			console.log(`${BLUE} **** BLOCK EVENTS with PRIVATE DATA ****${RESET}`);
			const network2Org1 = await gateway2Org1.getNetwork(channelName);
			const contract2Org1 = network2Org1.getContract(chaincodeName);

			randomNumber = Math.floor(Math.random() * 1000) + 1;
			assetKey = `item-${randomNumber}`;

			let firstBlock = true; // simple indicator to track blocks

			try {
				let listener;

				// create a block listener
				listener = async (event) => {
					if (firstBlock) {
						console.log(`${GREEN}<-- Block Event Received - block number: ${event.blockNumber.toString()}` +
							'\n### Note:' +
							'\n    This block event represents the current top block of the ledger.' +
							`\n    All block events after this one are events that represent new blocks added to the ledger${RESET}`);
						firstBlock = false;
					} else {
						console.log(`${GREEN}<-- Block Event Received - block number: ${event.blockNumber.toString()}${RESET}`);
					}
					const transEvents = event.getTransactionEvents();
					for (const transEvent of transEvents) {
						console.log(`*** transaction event: ${transEvent.transactionId}`);
						if (transEvent.privateData) {
							for (const namespace of transEvent.privateData.ns_pvt_rwset) {
								console.log(`    - private data: ${namespace.namespace}`);
								for (const collection of namespace.collection_pvt_rwset) {
									console.log(`     - collection: ${collection.collection_name}`);
									if (collection.rwset.reads) {
										for (const read of collection.rwset.reads) {
											console.log(`       - read set - ${BLUE}key:${RESET} ${read.key}  ${BLUE}value:${read.value.toString()}`);
										}
									}
									if (collection.rwset.writes) {
										for (const write of collection.rwset.writes) {
											console.log(`      - write set - ${BLUE}key:${RESET}${write.key} ${BLUE}is_delete:${RESET}${write.is_delete} ${BLUE}value:${RESET}${write.value.toString()}`);
										}
									}
								}
							}
						}
						if (transEvent.transactionData) {
							showTransactionData(transEvent.transactionData);
						}
					}
				};
				// now start the client side event service and register the listener
				console.log(`${GREEN}--> Start private data block event stream to peer in Org1${RESET}`);
				await network2Org1.addBlockListener(listener, {type: 'private'});
			} catch (eventError) {
				console.log(`${RED}<-- Failed: Setup block events - ${eventError}${RESET}`);
			}

			try {
				// C R E A T E
				console.log(`${GREEN}--> Submit Transaction: CreateAsset, ${assetKey} owned by Sam${RESET}`);
				transaction = contract2Org1.createTransaction('CreateAsset');

				// create the private data with salt and assign to the transaction
				const randomNumber = Math.floor(Math.random() * 100) + 1;
				const asset_properties = {
					object_type: 'asset_properties',
					asset_id: assetKey,
					Price: '90',
					salt: Buffer.from(randomNumber.toString()).toString('hex')
				};
				const asset_properties_string = JSON.stringify(asset_properties);
				transaction.setTransient({
					asset_properties: Buffer.from(asset_properties_string)
				});
				// With the addition of private data to the transaction
				// We must only send this to the organization that will be
				// saving the private data or we will get an endorsement policy failure
				transaction.setEndorsingOrganizations(org1);
				// endorse and commit - private data (transient data) will be
				// saved to the implicit collection on the peer
				await transaction.submit(assetKey, 'blue', '10', 'Sam', '100');
				console.log(`${GREEN}<-- Submit CreateAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (createError) {
				console.log(`${RED}<-- Failed: CreateAsset - ${createError}${RESET}`);
			}
			await sleep(5000); // need to wait for event to be committed
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should be owned by Sam${RESET}`);
				const resultBuffer = await contract2Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Sam', '100', '90');
			} catch (readError) {
				console.log(`${RED}<-- Failed: ReadAsset - ${readError}${RESET}`);
			}

			try {
				// U P D A T E
				console.log(`${GREEN}--> Submit Transaction: UpdateAsset ${assetKey} update appraised value to 200`);
				transaction = contract2Org1.createTransaction('UpdateAsset');

				// update the private data with new salt and assign to the transaction
				const randomNumber = Math.floor(Math.random() * 100) + 1;
				const asset_properties = {
					object_type: 'asset_properties',
					asset_id: assetKey,
					Price: '90',
					salt: Buffer.from(randomNumber.toString()).toString('hex')
				};
				const asset_properties_string = JSON.stringify(asset_properties);
				transaction.setTransient({
					asset_properties: Buffer.from(asset_properties_string)
				});
				transaction.setEndorsingOrganizations(org1);

				await transaction.submit(assetKey, 'blue', '10', 'Sam', '200');
				console.log(`${GREEN}<-- Submit UpdateAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (updateError) {
				console.log(`${RED}<-- Failed: UpdateAsset - ${updateError}${RESET}`);
			}
			await sleep(5000); // need to wait for event to be committed
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should now have appraised value of 200${RESET}`);
				const resultBuffer = await contract2Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Sam', '200', '90');
			} catch (readError) {
				console.log(`${RED}<-- Failed: ReadAsset - ${readError}${RESET}`);
			}

			try {
				// T R A N S F E R
				console.log(`${GREEN}--> Submit Transaction: TransferAsset ${assetKey} to Mary`);
				transaction = contract2Org1.createTransaction('TransferAsset');

				// update the private data with new salt and assign to the transaction
				const randomNumber = Math.floor(Math.random() * 100) + 1;
				const asset_properties = {
					object_type: 'asset_properties',
					asset_id: assetKey,
					Price: '180',
					salt: Buffer.from(randomNumber.toString()).toString('hex')
				};
				const asset_properties_string = JSON.stringify(asset_properties);
				transaction.setTransient({
					asset_properties: Buffer.from(asset_properties_string)
				});
				transaction.setEndorsingOrganizations(org1);

				await transaction.submit(assetKey, 'Mary');
				console.log(`${GREEN}<-- Submit TransferAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (transferError) {
				console.log(`${RED}<-- Failed: TransferAsset - ${transferError}${RESET}`);
			}
			await sleep(5000); // need to wait for event to be committed
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should now be owned by Mary${RESET}`);
				const resultBuffer = await contract2Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Mary', '200', '180');
			} catch (readError) {
				console.log(`${RED}<-- Failed: ReadAsset - ${readError}${RESET}`);
			}

			try {
				// D E L E T E
				console.log(`${GREEN}--> Submit Transaction: DeleteAsset ${assetKey}`);
				transaction = contract2Org1.createTransaction('DeleteAsset');
				await transaction.submit(assetKey);
				console.log(`${GREEN}<-- Submit DeleteAsset Result: committed, asset ${assetKey}${RESET}`);
			} catch (deleteError) {
				console.log(`${RED}<-- Failed: DeleteAsset - ${deleteError}${RESET}`);
			}
			await sleep(5000); // need to wait for event to be committed
			try {
				// R E A D
				console.log(`${GREEN}--> Evaluate: ReadAsset, - ${assetKey} should now be deleted${RESET}`);
				const resultBuffer = await contract2Org1.evaluateTransaction('ReadAsset', assetKey);
				checkAsset(org1, resultBuffer, 'blue', '10', 'Mary', '200');
				console.log(`${RED}<-- Failed: ReadAsset - should not have read this asset${RESET}`);
			} catch (readError) {
				console.log(`${GREEN}<-- Success: ReadAsset - ${readError}${RESET}`);
			}

			// all done with this listener
			network2Org1.removeBlockListener(listener);*/

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

	await sleep(30000);
	console.log(`${BLUE} **** END ****${RESET}`);
	process.exit(0);
}
main();
