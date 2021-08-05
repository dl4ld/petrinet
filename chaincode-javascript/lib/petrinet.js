'use strict';

const { Contract } = require('fabric-contract-api');

async function getAssetJSON(ctx, key) {
	const asset = await ctx.stub.getState(key);
	if(!asset || asset.length === 0) {
		return {}
	}
	return JSON.parse(asset.toString())
}

async function putAssetJSON(ctx, key, asset) {
	await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
}

class Petrinet extends Contract {

    constructor() {
	   super('nl.dl4ld.petrinet.');
    }
 
    async PutToken(ctx, tokenId, netId, placeId) {
	    const myOrgId = ctx.clientIdentity.getMSPID();
	    const tokenKey = ctx.stub.createCompositeKey(this.name, ['token', tokenId]);
	    const netKey = ctx.stub.createCompositeKey(this.name, ['net', netId]);
	    const placeKey = ctx.stub.createCompositeKey(this.name, ['place', placeId]);
	    const token = await getAssetJSON(ctx, tokenKey);
	    const place = await getAssetJSON(ctx, placeKey);
	    const net = await getAssetJSON(ctx, netKey);
	    if(!net || !token || !place) {
		throw new Error(`Could not proceed with PutToken as an asset was not found!`);
	    }

	    // I can not do anything with others' tokens
	    if(token.owner != myOrgId) {
		throw new Error(`You do not own token ${tokenId}!`);
	    }

	    const firedTransitions = []
	    // Check if token and place are owned by same org.
	    // If owners are different generate and event.
	    if(token.owner != place.owner) {
		// Place is not mine hence transfer token to place owner
		token.owner = place.owner;
		// Update token asset
		await putAssetJSON(ctx, tokenKey, token)

		const eventData = {
			token: tokenId,
			place: placeId,
			net: netId
		}
		const eventDataBuffer = Buffer.from(JSON.stringify(eventData));
		await ctx.stub.setEvent('TransitionRequest', eventDataBuffer);
		return {
			action: 'TransitionRequest'
		}
	    }
	    // If owners are the same, move the token.
	    place.tokens.push(token)
	    await ctx.stub.putState(placeKey, Buffer.from(JSON.stringify(place)));

	    // Check for fired transitions with new token move
	    const arcs = net.arcs.filter(arc => {
		return ((arc.src.id == place.id) && (arc.src.type == 'place'))
	    })

	    await Promise.all(arcs.map(async a => {
		const inputPlaces = net.arcs.filter(d => {
			return ((a.dst.id == d.dst.id) && ( d.dst.type == 'transition'))
		})

		let fire = true
		await Promise.all(inputPlaces.map(async p => {
			console.log("input place: ",p)
			// ignore the current place
			if(p.src.id == placeId) {
				return
			}
	    		const k = ctx.stub.createCompositeKey(this.name, ['place', p.src.id]);
			console.log("place key: ",k)
			const ir = await ctx.stub.getState(k);
			if(!ir) {
				console.log("place: " + k + " not found.")
				return
			}
			const i = JSON.parse(ir.toString())
			console.log(i)
			if(i.tokens.length == 0) {
				fire = false
			}
		}))

		if(fire == true) {
	    		const k = ctx.stub.createCompositeKey(this.name, ['transition', a.dst.id]);
			const t = await ctx.stub.getState(k)
		    	if (!t || t.length === 0) {
				throw new Error(`Transition ${a.dst.id} does not exist`);
		    	} else {
				const transition = JSON.parse(t)
				firedTransitions.push(transition)
				net.states[transition.id] = "FIRING"
				console.log("fire: ", transition)
				const assetBuffer = Buffer.from(JSON.stringify(transition));
				await ctx.stub.setEvent('Fire', assetBuffer);
			}
		}
	    }))

	    if(firedTransitions) {
	    	await ctx.stub.putState(netKey, Buffer.from(JSON.stringify(net)));
		return {
			action: "FiredTransitions"
		}
	    }

	    return {
		    action: "NoActionTaken"
	    }
    }

    async CreateNet(ctx, netId, netJSON) {
	    const net = JSON.parse(netJSON);
	    const key = ctx.stub.createCompositeKey(this.name, ['net', netId]);
	    const asset = {
		    id: netId,
		    issuer: ctx.clientIdentity.getID(),
		    owner: ctx.clientIdentity.getMSPID(),
		    arcs: [],
		    domains: {},
		    states: {},
		    state: "ACTIVE"
	    }
	    /*
	     * arc struct
	     * {
	     *    src: {
	     *    	type: place|transition,
	     *    	id: string
	     *    },
	     *    dst: {
	     *      	type: place|transition,
	     *      	id: string
	     *    }
	     *}
	     */
	    let verified = true
	    await Promise.all(net.map(async arc => {
		    if(arc.src.type == 'place') {
	    		    const keySrc = ctx.stub.createCompositeKey(this.name, ['place', arc.src.id])
			    const place = await getAssetJSON(ctx, keySrc);
			    if (!place) {
				verified = false
				return
			    }

			    asset.domains[place.owner] = {
				    status: "NotAccepted"
			    }

	    		    const keyDst = ctx.stub.createCompositeKey(this.name, ['transition', arc.dst.id])
			    const transition = await getAssetJSON(ctx, keyDst);
			    if (!transition) {
				verified = false
				return
			    }

			    asset.states[transition.id] = "EMPTY";

			    asset.domains[transition.owner] = {
				    status: "NotAccepted"
			    }
		    }

		    if(arc.src.type == 'transition') {
	    		    const keySrc = ctx.stub.createCompositeKey(this.name, ['transition', arc.src.id])
			    const transition = await getAssetJSON(ctx, keySrc);
			    if (!transition) {
				//throw new Error(`The transition ${arc.src.id} does not exist`);
				verified = false
				return
			    }

			    asset.states[transition.id] = "EMPTY";

			    asset.domains[transition.owner] = {
				    status: "NotAccepted"
			    }

	    		    const keyDst = ctx.stub.createCompositeKey(this.name, ['place', arc.dst.id])
			    const place = await getAssetJSON(ctx, keyDst);
			    if (!place) {
				verified = false
				return
			    }
			    asset.domains[place.owner] = {
				    status: "NotAccepted"
			    }
		    }
	    }));

	    if(verified) {
		asset.arcs = net
		asset.domains[asset.owner] = { status: "Accepted" }
		console.log("asset key: ", key)
            	await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
		const assetBuffer = Buffer.from(JSON.stringify(asset));
		await ctx.stub.setEvent('NewNet', assetBuffer);
		return asset;
	    } else {
		throw new Error(`Petrinet creation failed ${netId}`);
	    }
    }
    
    async GetNet(ctx, netId) {
	    const key = ctx.stub.createCompositeKey(this.name, ['net', netId]);
	    const net = await ctx.stub.getState(key);
	    if (!net || net.length === 0) {
            	throw new Error(`The net ${netId} does not exist`);
	    }
	    return net.toString();
    }

    async AcceptNet(ctx, netId) {
	    const netKey = ctx.stub.createCompositeKey(this.name, ['net', netId])
	    const net = await getAssetJSON(ctx, netKey)
	    if(!net) {
		    throw new Error(`Petrinet ${netId} not found.`)
	    }
	    const myOrgId = ctx.clientIdentity.getMSPID()
	    if(!net.domains[myOrgId]) {
		    throw new Error(`${myOrgId} not part of petrinet ${netId}.`)
	    }
	    net.domains[myOrgId]['status'] = 'Accepted'
	    await ctx.stub.putState(netKey, Buffer.from(JSON.stringify(net)))
	    return net
    }

    async CreatePlace(ctx, placeId) {
	    const key = ctx.stub.createCompositeKey(this.name, ['place', placeId])
	    const place = {
		    id: placeId,
		    issuer: ctx.clientIdentity.getID(),
		    owner: ctx.clientIdentity.getMSPID(),
		    tokens: [],
		    state: "ACTIVE"
	    }
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(place)));
	    return place
    }

    async GetPlace(ctx, placeId) {
	    const key = ctx.stub.createCompositeKey(this.name, ['place', placeId]);
	    const place = await ctx.stub.getState(key);
	    if (!place || place.length === 0) {
            	throw new Error(`The place ${placeId} does not exist`);
	    }
	    return place.toString();
    }
    
    async CreateToken(ctx, tokenId, color) {
	    const key = ctx.stub.createCompositeKey(this.name, ['token', tokenId])
	    const token = {
		    id: tokenId,
		    issuer: ctx.clientIdentity.getID(),
		    owner: ctx.clientIdentity.getMSPID(),
		    color: JSON.parse(color),
		    state: "ACTIVE"
	    }
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(token)));
	    return token
    }

    async GetToken(ctx, tokenId) {
	    const key = ctx.stub.createCompositeKey(this.name, ['token', tokenId]);
	    const token = await ctx.stub.getState(key);
	    if (!token || token.length === 0) {
            	throw new Error(`The token ${tokenId} does not exist`);
	    }
	    return token.toString();
    }

    async CreateTransition(ctx, transitionId, functionURI) {
	    const key = ctx.stub.createCompositeKey(this.name, ['transition', transitionId])
	    const transition = {
		    id: transitionId,
		    issuer: ctx.clientIdentity.getID(),
		    owner: ctx.clientIdentity.getMSPID(),
		    action: {
			type: "nl.dl4ld.actorAction",
			uri: functionURI
		    },
		    state: "ACTIVE"
	    }
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(transition)));
	    return transition
    }
    
    async CreateWebhookTransition(ctx, transitionId, webhookURI, headers) {
	    const key = ctx.stub.createCompositeKey(this.name, ['transition', transitionId])
	    const transition = {
		    id: transitionId,
		    issuer: ctx.clientIdentity.getID(),
		    owner: ctx.clientIdentity.getMSPID(),
		    action: {
			type: "nl.dl4ld.webhook",
			uri: webhookURI,
			headers: headers
		    },
		    state: "ACTIVE"
	    }
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(transition)));
	    return transition
    }

    async GetTransition(ctx, transitionId) {
	    const key = ctx.stub.createCompositeKey(this.name, ['transition', transitionId]);
	    const transition = await ctx.stub.getState(key);
	    if (!transition || transition.length === 0) {
            	throw new Error(`The transition ${transitionId} does not exist`);
	    }
	    return transition.toString();
    }

    // CreateAsset issues a new asset to the world state with given details.
    async CreateAsset(ctx, id, type, issuer, owner, data) {
        const asset = {
            id: ctx.stub.createCompositeKey(type, [id]),
            issuer: ctx.clientIdentity.getID(),
            owner: ctx.clientIdentity.getMSPID(),
	    data: data
        };
        await ctx.stub.putState(id, Buffer.from(JSON.stringify(asset)));
        return JSON.stringify(asset);
    }

    // ReadAsset returns the asset stored in the world state with given id.
    async ReadAsset(ctx, id) {
        const assetJSON = await ctx.stub.getState(id); // get the asset from chaincode state
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return assetJSON.toString();
    }

    // UpdateAsset updates an existing asset in the world state with provided parameters.
    async UpdateAsset(ctx, id, color, size, owner, appraisedValue) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        // overwriting original asset with new asset
        const updatedAsset = {
            id: id,
            Color: color,
            Size: size,
            owner: owner,
            AppraisedValue: appraisedValue,
        };
        return ctx.stub.putState(id, Buffer.from(JSON.stringify(updatedAsset)));
    }

    // DeleteAsset deletes an given asset from the world state.
    async DeleteAsset(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return ctx.stub.deleteState(id);
    }

    // AssetExists returns true when asset with given id exists in world state.
    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }

    // TransferAsset updates the owner field of asset with given id in the world state.
    async TransferAsset(ctx, id, newOwner) {
        const assetString = await this.ReadAsset(ctx, id);
        const asset = JSON.parse(assetString);
        asset.owner = newOwner;
        return ctx.stub.putState(id, Buffer.from(JSON.stringify(asset)));
    }

    // GetAllAssets returns all assets found in the world state.
    async GetAllAssets(ctx) {
        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push({ Key: result.value.key, Record: record });
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }
}

module.exports = Petrinet;
