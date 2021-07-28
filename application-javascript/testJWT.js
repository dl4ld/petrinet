/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

/**
 * Application that shows events when creating and updating an asset
 *   -- How to register a contract listener for chaincode events
 *   -- How to get the chaincode event name and value from the chaincode event
 *   -- How to retrieve the transaction and block information from the chaincode event
 *   -- How to register a block listener for full block events
 *   -- How to retrieve the transaction and block information from the full block event
 *   -- How to register to recieve private data associated with transactions when
 *      registering a block listener
 *   -- How to retreive the private data from the full block event
 *   -- The listener will be notified of an event at anytime. Notice that events will
 *      be posted by the listener after the application activity causing the ledger change
 *      and during other application activity unrelated to the event
 *   -- How to connect to a Gateway that will not use events when submitting transactions.
 *      This may be useful when the application does not want to wait for the peer to commit
 *      blocks and notify the application.
 *
 * To see the SDK workings, try setting the logging to be displayed on the console
 * before executing this application.
 *        export HFC_LOGGING='{"debug":"console"}'
 * See the following on how the SDK is working with the Peer's Event Services
 * https://hyperledger-fabric.readthedocs.io/en/latest/peer_event_services.html
 *
 * See the following for more details on using the Node SDK
 * https://hyperledger.github.io/fabric-sdk-node/release-2.2/module-fabric-network.html
 */

// pre-requisites:
// - fabric-sample two organization test-network setup with two peers, ordering service,
//   and 2 certificate authorities
//         ===> from directory test-network
//         ./network.sh up createChannel -ca
//
// - Use the asset-transfer-events/chaincode-javascript chaincode deployed on
//   the channel "mychannel". The following deploy command will package, install,
//   approve, and commit the javascript chaincode, all the actions it takes
//   to deploy a chaincode to a channel.
//         ===> from directory test-network
//         ./network.sh deployCC -ccn events -ccp ../asset-transfer-events/chaincode-javacript/ -ccl javascript -ccep "OR('Org1MSP.peer','Org2MSP.peer')"
//
// - Be sure that node.js is installed
//         ===> from directory asset-transfer-sbe/application-javascript
//         node -v
// - npm installed code dependencies
//         ===> from directory asset-transfer-sbe/application-javascript
//         npm install
// - to run this test application
//         ===> from directory asset-transfer-sbe/application-javascript
//         node app.js

// NOTE: If you see an error like these:
/*

   Error in setup: Error: DiscoveryService: mychannel error: access denied

   OR

   Failed to register user : Error: fabric-ca request register failed with errors [[ { code: 20, message: 'Authentication failure' } ]]

	*/
// Delete the /fabric-samples/asset-transfer-sbe/application-javascript/wallet directory
// and retry this application.
//
// The certificate authority must have been restarted and the saved certificates for the
// admin and application user are not valid. Deleting the wallet store will force these to be reset
// with the new certificate authority.
//

// use this to set logging, must be set before the require('fabric-network');
process.env.HFC_LOGGING = '{"debug": "./debug.log"}';

const { Gateway, Wallets } = require('fabric-network');
const EventStrategies = require('fabric-network/lib/impl/event/defaulteventhandlerstrategies');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../test-application/javascript/CAUtil.js');
const { buildCCPOrg1, buildWallet } = require('../../test-application/javascript/AppUtil.js');

const channelName = 'mychannel';
const chaincodeName = process.argv[2] || 'petrinet10';

const org1 = 'Org1MSP';
const Org1UserId = 'appUser1';

const RED = '\x1b[31m\n';
const GREEN = '\x1b[32m\n';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

/**
 * Perform a sleep -- asynchronous wait
 * @param ms the time in milliseconds to sleep for
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initGatewayForOrg1(useCommitEvents) {
	console.log(`${GREEN}--> Fabric client user & Gateway init: Using Org1 identity to Org1 Peer${RESET}`);
	// build an in memory object with the network configuration (also known as a connection profile)
	const ccpOrg1 = buildCCPOrg1();

	// build an instance of the fabric ca services client based on
	// the information in the network configuration
	const caOrg1Client = buildCAClient(FabricCAServices, ccpOrg1, 'ca.org1.example.com');

	// setup the wallet to cache the credentials of the application user, on the app server locally
	const walletPathOrg1 = path.join(__dirname, 'walletOrg1', 'org1');
	const walletOrg1 = await buildWallet(Wallets, walletPathOrg1);

	console.log(walletOrg1)
	console.log(walletOrg1.store.storePath)

	// in a real application this would be done on an administrative flow, and only once
	// stores admin identity in local wallet, if needed
	await enrollAdmin(caOrg1Client, walletOrg1, org1);
	// register & enroll application user with CA, which is used as client identify to make chaincode calls
	// and stores app user identity in local wallet
	// In a real application this would be done only when a new user was required to be added
	// and would be part of an administrative flow
	await registerAndEnrollUser(caOrg1Client, walletOrg1, org1, Org1UserId, 'org1.department1');

	const fileName = walletOrg1.store.storePath + '/' + Org1UserId + '.id';

	const fileData = fs.readFileSync(fileName, 'utf-8')
	const data = JSON.parse(fileData);
	const pub = data.credentials.certificate
	const priv = data.credentials.privateKey

	const token = jwt.sign({
		payload: "hello"
	}, priv, { algorithm: 'RS256'})

	console.log("token with wallet: ", token)
	jwt.verify(token, pub, function(err, decoded) {
		if(err) {
			console.log(err)
			return
		}
		console.log("verify wallet token: ", decoded)
	})


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
		let randomNumber = Math.floor(Math.random() * 1000) + 1;
		// use a random key so that we can run multiple times
		let assetKey = `${randomNumber}`;
		randomNumber = Math.floor(Math.random() * 1000) + 1;
		let assetKey2 = process.argv[3];

		/** ******* Fabric client init: Using Org1 identity to Org1 Peer ******* */
		const gateway1Org1 = await initGatewayForOrg1(true); // transaction handling uses commit events
		console.log("here")
	} catch(e) {
		console.log(e);
	}
}

main()
