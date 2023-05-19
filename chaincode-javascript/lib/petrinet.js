'use strict';

const { Contract } = require('fabric-contract-api');
const jwt = require('jsonwebtoken');

async function getAssetJSON(ctx, key) {
  const asset = await ctx.stub.getState(key);
  if (!asset || asset.length === 0) {
    return null;
  }
  return JSON.parse(asset.toString());
}

async function putAssetJSON(ctx, key, asset) {
  await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
}

function getOutputsById(net, id) {
  return net.arcs
    .filter((arc) => {
      return arc.src.id === id;
    })
    .map((arc) => {
      return arc.dst;
    });
}

function getInputsById(net, id) {
  return net.arcs
    .filter((arc) => {
      return arc.dst.id === id;
    })
    .map((arc) => {
      return arc.src;
    });
}

function isSpaceInPlace(net, place) {
  // Validate place for k-boundedness
  return place.tokens.length < net.k;
}

function isEmpty(obj) {
  // null and undefined are "empty"
  if (obj === null) {
    return true;
  }

  // Assume if it has a length property with a non-zero value
  // that that property is correct.
  if (obj.length && obj.length > 0) {
    return false;
  }
  if (obj.length === 0) {
    return true;
  }

  // Otherwise, does it have any properties of its own?
  // Note that this doesn't handle
  // toString and toValue enumeration bugs in IE < 9
  for (let key in obj) {
    if (hasOwnProperty.call(obj, key)) {
      return false;
    }
  }

  return true;
}

async function getAllResults(iterator, isHistory) {
  let allResults = [];
  let res = { done: false, value: null };

  while (true) {
    res = await iterator.next();
    let jsonRes = {};
    if (res.value && res.value.value.toString()) {
      if (isHistory && isHistory === true) {
        jsonRes.TxId = res.value.txId;
        jsonRes.Timestamp = res.value.timestamp;
        jsonRes.Timestamp = new Date(res.value.timestamp.seconds.low * 1000);
        let ms = res.value.timestamp.nanos / 1000000;
        jsonRes.Timestamp.setMilliseconds(ms);
        if (res.value.is_delete) {
          jsonRes.IsDelete = res.value.is_delete.toString();
        } else {
          try {
            jsonRes.Value = JSON.parse(res.value.value.toString('utf8'));
          } catch (err) {
            console.log(err);
            jsonRes.Value = res.value.value.toString('utf8');
          }
        }
      } else {
        // non history query ..
        jsonRes.Key = res.value.key;
        try {
          jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
        } catch (err) {
          console.log(err);
          jsonRes.Record = res.value.value.toString('utf8');
        }
      }
      allResults.push(jsonRes);
    }
    // check to see if we have reached the end
    if (res.done) {
      // explicitly close the iterator
      console.log('iterator is done');
      await iterator.close();
      return allResults;
    }
  } // while true
}

class Petrinet extends Contract {
  constructor() {
    super('nl.dl4ld.petrinet.');
  }

  async GenerateToken(ctx, tokenId, orgId, type, data) {
    const myOrgId = ctx.clientIdentity.getMSPID();
    if (myOrgId === orgId) {
      throw new Error('Can not generate token for yourself!');
    }
    return this.CreateToken(ctx, tokenId, type, data, orgId);
  }

  async PutToken(ctx, tokenId, netId, placeId) {
    const myOrgId = ctx.clientIdentity.getMSPID();
    const tokenKey = ctx.stub.createCompositeKey(this.name, ['token', tokenId]);
    const netKey = ctx.stub.createCompositeKey(this.name, ['net', netId]);
    const placeKey = ctx.stub.createCompositeKey(this.name, ['place', placeId]);
    const token = await getAssetJSON(ctx, tokenKey);
    const place = await getAssetJSON(ctx, placeKey);
    const net = await getAssetJSON(ctx, netKey);
    const events = [];
    if (!net || !token || !place) {
      throw new Error('Could not proceed with PutToken as an asset was not found!');
    }

    // Net needs to be in ACTIVE state to run
    if (net.status !== 'ACTIVE') {
      throw new Error('Could not proceed with PutToken as net is not ACTIVE');
    }

    // I can not do anything with others' tokens
    if (token.owner !== myOrgId && token.owner !== 'Everyone') {
      throw new Error(`Token is not yours ${tokenId}!`);
    }
    // Check if token is in READY state
    if (token.status !== 'READY') {
      throw new Error(`Token not in READY state ${tokenId}!`);
    }

    const firedTransitions = [];
    // Check if token and place are owned by same org.
    // If owners are different; transfer ownership.
    if (token.owner !== place.owner) {
      // Check if place is locked by owner.
      if (place.isLocked === true) {
        throw new Error(`Only place owner can put token in ${place.id}`);
      }
      // Place is not mine hence transfer token to place owner
      // token.owner = place.owner;
      // Update token asset
      // await putAssetJSON(ctx, tokenKey, token)
    }

    // Check for type match
    if (token.type !== place.type) {
      throw new Error(`Place only accepts tokens of type ${place.type}`);
    }

    // Check if Place can accept tokens.
    if (!isSpaceInPlace(net, place)) {
      throw new Error(`Place exceeds number of tokens: ${net.k}`);
    }

    // Move token to place.
    place.tokens.push(token);
    token.status = token.reuse ? 'USED': 'READY';

    await ctx.stub.putState(placeKey, Buffer.from(JSON.stringify(place)));
    // Update token asset
    await putAssetJSON(ctx, tokenKey, token);

    // Generate PutToken event
    const eventData = {
      net: netId,
      place: placeId,
      token: tokenId,
    };
    events.push({
      type: 'PutToken',
      data: eventData,
      owner: myOrgId,
    });

    // Check for fired transitions with new token move
    const arcs = net.arcs.filter((arc) => {
      return arc.src.id === place.id && arc.src.type === 'place';
    });

    await Promise.all(
      arcs.map(async (a) => {
        const inputPlaces = net.arcs.filter((d) => {
          return a.dst.id === d.dst.id && d.dst.type === 'transition';
        });

        let fire = true;
        const inputPlacesAsAsset = [];
        await Promise.all(
          inputPlaces.map(async (p) => {
            // Ignore the current place
            if (p.src.id === placeId) {
              return;
            }
            const k = ctx.stub.createCompositeKey(this.name, [
              'place',
              p.src.id,
            ]);
            const ir = await ctx.stub.getState(k);
            if (!ir) {
              console.log('place: ' + k + ' not found.');
              return;
            }
            const i = JSON.parse(ir.toString());
            if (i.tokens.length === 0) {
              fire = false;
            } else {
              inputPlacesAsAsset.push(i);
            }
          })
        );

        if (fire === true) {
          const transitionId = a.dst.id;
          const k = ctx.stub.createCompositeKey(this.name, [
            'transition',
            a.dst.id,
          ]);
          const t = await ctx.stub.getState(k);
          if (!t || t.length === 0) {
            throw new Error(`Transition ${a.dst.id} does not exist.`);
          } else {
            const transition = JSON.parse(t);
            if (transition.status === 'FIRING') {
              //throw new Error(`Transition ${a.dst.id} is already firing.`);
            }

            firedTransitions.push(transition);
            transition.status = 'FIRING';

            // Add input tokens to the firing transitions
            // so we can pass data between transitions
            let inputTokens = [];
            inputPlacesAsAsset.forEach((p) => {
              inputTokens = inputTokens.concat(p.tokens);
            });
            inputTokens.push(token);

            await ctx.stub.putState(k, Buffer.from(JSON.stringify(transition)));
            transition.outputs = getOutputsById(net, transitionId);
            transition.net = netId;
            transition.inputPlaces = inputPlacesAsAsset;
            transition.inputTokens = inputTokens;
            console.log('fire: ', transition);
            events.push({
              type: 'Fire',
              data: transition,
              owner: myOrgId,
            });
          }
        }
      })
    );

    const eventBuffer = Buffer.from(JSON.stringify(events));
    await ctx.stub.setEvent('PutRemoveTokens', eventBuffer);

    if (firedTransitions) {
      return {
        action: 'FiredTransitions',
        transitions: firedTransitions,
      };
    }

    return {
      action: 'NoActionTaken',
    };
  }

  async CompleteTransition(
    ctx,
    netId,
    transitionId,
    tokenIds,
    transitionOutputData
  ) {
    const that = this;
    const myOrgId = ctx.clientIdentity.getMSPID();
    const netKey = ctx.stub.createCompositeKey(this.name, ['net', netId]);
    const transitionKey = ctx.stub.createCompositeKey(this.name, [
      'transition',
      transitionId,
    ]);
    const transition = await getAssetJSON(ctx, transitionKey);
    const net = await getAssetJSON(ctx, netKey);
    const tokenArray = JSON.parse(tokenIds);
    if (!net || !transition) {
      throw new Error('Could not proceed with CompleteTransition as an asset was not found!');
    }

    const effectedPlaces = [];
    const events = [];

    const inputPromises = getInputsById(net, transitionId)
      .filter((p) => {
        return p.type === 'place';
      })
      .map(async (p) => {
        const placeKey = ctx.stub.createCompositeKey(this.name, [
          'place',
          p.id,
        ]);
        const place = await getAssetJSON(ctx, placeKey);
        console.log(`CompleteTransaction ${JSON.stringify(place)}`);
        const token = place.tokens.pop();
        if (token) {
          // Generate RemoveToken event
          const eventData = {
            net: netId,
            place: p.id,
            token: token.id,
          };
          events.push({
            type: 'RemoveToken',
            data: eventData,
            owner: myOrgId,
          });
        }
        console.log(`Tokens ${place.tokens.length}`);
        effectedPlaces.push(place);
        await ctx.stub.putState(placeKey, Buffer.from(JSON.stringify(place)));
      });

    const outputPromises = getOutputsById(net, transitionId)
      .filter((p) => {
        return p.type === 'place';
      })
      .map(async (p) => {
        try {
          console.log(`CompleteTransition outputs: ${JSON.stringify(p)}`);
          const placeKey = ctx.stub.createCompositeKey(this.name, [
            'place',
            p.id,
          ]);
          const place = await getAssetJSON(ctx, placeKey);

          // Create token
          const tokenId = tokenArray.pop();
          const key = ctx.stub.createCompositeKey(this.name, [
            'token',
            tokenId,
          ]);
          const token = {
            id: tokenId,
            issuer: ctx.clientIdentity.getID(),
            owner: ctx.clientIdentity.getMSPID(),
            type: place.type,
            data: transitionOutputData,
            disposable: true,
            status: 'USED',
          };

          await ctx.stub.putState(key, Buffer.from(JSON.stringify(token)));

          // Add token to place
          place.tokens.push(token);
          await ctx.stub.putState(placeKey, Buffer.from(JSON.stringify(place)));

          // Generate event
          const eventData = {
            net: netId,
            place: p.id,
            token: token.id,
          };
          events.push({
            type: 'PutToken',
            data: eventData,
            owner: myOrgId,
          });

          // Check for firing
          const placePromises = getOutputsById(net, p.id)
            .filter((t) => {
              return t.type === 'transition';
            })
            .map((t) => {
              return new Promise((resolve, reject) => {
                // If all inputs have a token fire transition
                const inputPlaces = getInputsById(net, t.id).map(async (p) => {
                  if (p.id === place.id) {
                    return place;
                  } else {
                    const placeKey = ctx.stub.createCompositeKey(that.name, [
                      'place',
                      p.id,
                    ]);
                    const place = await getAssetJSON(ctx, placeKey);
                    return place;
                  }
                });

                //const ips = await Promise.all(inputPlaces)
                Promise.all(inputPlaces)
                  .then((ips) => {
                    const mustFire = ips.every((t) => {
                      //console.log(`Places: ${JSON.stringify(t)}`);
                      return t.tokens.length > 0;
                    });

                    if (mustFire) {
                      const transitionKey = ctx.stub.createCompositeKey(
                        that.name,
                        ['transition', t.id]
                      );
                      getAssetJSON(ctx, transitionKey)
                        .then((transition) => {
                          const inputTokens = [].concat.apply(
                            [],
                            ips.map((p) => p.tokens)
                          );
                          transition.outputs = getOutputsById(net, t.id);
                          transition.net = net.id;
                          transition.inputPlaces = ips;
                          transition.inputTokens = inputTokens;

                          events.push({
                            type: 'Fire',
                            data: transition,
                            owner: myOrgId,
                          });
                          console.log(`Transition ${t.id} WILL fire!`);
                          console.log(transition);
                          resolve();
                        })
                        .catch((err) => {
                          reject(err);
                        });
                    } else {
                      console.log(`Transition ${t.id} NOT fire!`);
                      resolve();
                    }
                  })
                  .catch((err) => {
                    reject(err);
                  });
              }); //Promise
            }); // map

          await Promise.all(placePromises);
        } catch (err) {
          console.log(err);
        }
      });

    try {
      await Promise.all([...inputPromises, ...outputPromises]);
    } catch (err) {
      console.log(err);
    }
    transition.status = 'READY';
    await ctx.stub.putState(
      transitionKey,
      Buffer.from(JSON.stringify(transition))
    );
    events.push({
      type: 'CompleteTransition',
      data: {
        transitionId: transitionId,
        netId: netId,
      },
      owner: myOrgId,
    });
    const eventBuffer = Buffer.from(JSON.stringify(events));
    await ctx.stub.setEvent('PutRemoveTokens', eventBuffer);
    console.log(`New events ${JSON.stringify(events)}`);
    console.log(`completeTransition ${transitionId} returning`);
    return {
      action: 'CompletedTransition',
      effectedPlaces: effectedPlaces,
    };
  }

  // Revoke authorization for net
  async RevokeNet(ctx, netId) {
    const myOrgId = ctx.clientIdentity.getMSPID();
    const netKey = ctx.stub.createCompositeKey(this.name, ['net', netId]);
    const net = await getAssetJSON(ctx, netKey);
    if (!net) {
      throw new Error('Could not proceed with RevokeNet as an asset was not found!');
    }
    if (net.domains[myOrgId].status === 'Accepted') {
      net.domains[myOrgId].status = 'NotAccepted';
      net.status = 'INACTIVE';
    }
    ctx.stub.putState(netKey, Buffer.from(JSON.stringify(net)));
  }

  async DeleteNet(ctx, netId) {
    const key = ctx.stub.createCompositeKey(this.name, ['net', netId]);
    const net = await getAssetJSON(ctx, key);
    if (!net) {
      throw new Error(`The net ${netId} does not exist!`);
    }
    if (net.owner !== ctx.clientIdentity.getMSPID()) {
      throw new Error(`Not authorized to delete ${netId}!`);
    }

    return ctx.stub.deleteState(key);
  }

  async CreateNet(ctx, netId, netArcs, details) {
    const arcs = JSON.parse(netArcs);
    const config = details ? JSON.parse(details) : {};
    const key = ctx.stub.createCompositeKey(this.name, ['net', netId]);
    const asset = {
      id: netId,
      issuer: ctx.clientIdentity.getID(),
      owner: ctx.clientIdentity.getMSPID(),
      arcs: [],
      domains: {},
      k: config.k || 1,
      statements: config.statements || [],
      status: 'NEW',
    };
    let verified = true;
    await Promise.all(
      arcs.map(async (arc) => {
        if (arc.src.type == 'net') {
          const keyNetSrc = ctx.stub.createCompositeKey(this.name, [
            'net',
            arc.src.id,
          ]);
          const netSrc = await getAssetJSON(ctx, keyNetSrc);

          const keyNetDst = ctx.stub.createCompositeKey(this.name, [
            'net',
            arc.dst.id,
          ]);
          const netDst = await getAssetJSON(ctx, keyNetDst);

          if (isEmpty(netSrc) || isEmpty(netDst)) {
            console.log('Failed connecting nets.');
            verified = false;
            return;
          }

          console.log(
            `Connecting subnets: ${JSON.stringify(netSrc)} to ${JSON.stringify(
              netDst
            )}`
          );

          asset.arcs = netSrc.arcs.concat(netDst.arcs);
          console.log(`New Net from subnets: ${JSON.stringify(asset)}`);
        }
        if (arc.src.type === 'place') {
          const keySrc = ctx.stub.createCompositeKey(this.name, [
            'place',
            arc.src.id,
          ]);
          const place = await getAssetJSON(ctx, keySrc);
          if (!place) {
            verified = false;
            return;
          }

          asset.domains[place.owner] = {
            status: 'NotAccepted',
          };

          const keyDst = ctx.stub.createCompositeKey(this.name, [
            'transition',
            arc.dst.id,
          ]);
          const transition = await getAssetJSON(ctx, keyDst);
          if (!transition) {
            verified = false;
            return;
          }

          asset.domains[transition.owner] = {
            status: 'NotAccepted',
          };
          asset.arcs.push(arc);
        }

        if (arc.src.type === 'transition') {
          const keySrc = ctx.stub.createCompositeKey(this.name, [
            'transition',
            arc.src.id,
          ]);
          const transition = await getAssetJSON(ctx, keySrc);
          if (!transition) {
            verified = false;
            return;
          }

          asset.domains[transition.owner] = {
            status: 'NotAccepted',
          };

          const keyDst = ctx.stub.createCompositeKey(this.name, [
            'place',
            arc.dst.id,
          ]);
          const place = await getAssetJSON(ctx, keyDst);
          if (!place) {
            verified = false;
            return;
          }
          asset.domains[place.owner] = {
            status: 'NotAccepted',
          };
          asset.arcs.push(arc);
        }
      })
    );

    if (verified) {
      asset.domains[asset.owner] = { status: 'Accepted' };
      if (
        Object.values(asset.domains).every((d) => {
          return d.status == 'Accepted';
        })
      ) {
        asset.status = 'ACTIVE';
        console.log('asset key: ', key);
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
        const assetBuffer = Buffer.from(JSON.stringify(asset));
        await ctx.stub.setEvent('NewNet', assetBuffer);
        return asset;
      } else {
        console.log('asset key: ', key);
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
        const assetBuffer = Buffer.from(JSON.stringify(asset));
        await ctx.stub.setEvent('NewNet', assetBuffer);
        return asset;
      }
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

  async GetAllTokens(ctx) {
    const resultsIterator = await ctx.stub.getStateByPartialCompositeKey(
      this.name,
      ['token']
    );
    return getAllResults(resultsIterator, false);
  }

  async GetAllPlaces(ctx) {
    const resultsIterator = await ctx.stub.getStateByPartialCompositeKey(
      this.name,
      ['place']
    );
    return getAllResults(resultsIterator, false);
  }

  async GetAllTransitions(ctx) {
    const resultsIterator = await ctx.stub.getStateByPartialCompositeKey(
      this.name,
      ['transition']
    );
    return getAllResults(resultsIterator, false);
  }

  async GetAllNets(ctx) {
    const resultsIterator = await ctx.stub.getStateByPartialCompositeKey(
      this.name,
      ['net']
    );
    return getAllResults(resultsIterator, false);
  }

  async GetIdentity(ctx, s) {
    const k = ctx.clientIdentity.idBytes.toString('utf8');
    console.log('JWT: ', s);
    console.log('Cert: ', k);
    jwt.verify(s, k, function (err, decoded) {
      if (err) {
        console.log(err);
        return;
      }
      console.log('Decoded: ', decoded);
    });
    return k;
  }

  async AcceptNet(ctx, netId) {
    const netKey = ctx.stub.createCompositeKey(this.name, ['net', netId]);
    const net = await getAssetJSON(ctx, netKey);
    if (!net) {
      throw new Error(`Petrinet ${netId} not found.`);
    }
    const myOrgId = ctx.clientIdentity.getMSPID();
    if (!net.domains[myOrgId]) {
      throw new Error(`${myOrgId} not part of petrinet ${netId}.`);
    }
    net.domains[myOrgId].status = 'Accepted';
    if (
      Object.values(net.domains).every((d) => {
        return d.status === 'Accepted';
      })
    ) {
      net.status = 'ACTIVE';
    }
    await ctx.stub.putState(netKey, Buffer.from(JSON.stringify(net)));
    return net;
  }

  async CreatePlace(ctx, placeId, type, details) {
    const key = ctx.stub.createCompositeKey(this.name, ['place', placeId]);
    const config = details ? JSON.parse(details) : {};
    if (!type) {
      throw new Error('Place must have a type.');
    }
    const place = {
      id: placeId,
      issuer: ctx.clientIdentity.getID(),
      owner: ctx.clientIdentity.getMSPID(),
      tokens: [],
      type: type,
      isLocked: config.isLocked,
      status: 'READY',
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(place)));
    return place;
  }

  async GetPlace(ctx, placeId) {
    const key = ctx.stub.createCompositeKey(this.name, ['place', placeId]);
    const place = await ctx.stub.getState(key);
    if (!place || place.length === 0) {
      throw new Error(`The place ${placeId} does not exist`);
    }
    return place.toString();
  }

  async CreateToken(ctx, tokenId, type, data, owner) {
    const key = ctx.stub.createCompositeKey(this.name, ['token', tokenId]);
    if (!type) {
      throw new Error('Token must have a type.');
    }
    const token = {
      id: tokenId,
      issuer: ctx.clientIdentity.getID(),
      owner: owner || ctx.clientIdentity.getMSPID(),
      type: type,
      data: data,
      status: 'READY',
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(token)));
    return token;
  }

  async GetToken(ctx, tokenId) {
    const key = ctx.stub.createCompositeKey(this.name, ['token', tokenId]);
    const token = await ctx.stub.getState(key);
    if (!token || token.length === 0) {
      throw new Error(`The token ${tokenId} does not exist`);
    }
    return token.toString();
  }

  async DeleteTransition(ctx, transitionId) {
    const key = ctx.stub.createCompositeKey(this.name, [
      'transition',
      transitionId,
    ]);
    const transition = await getAssetJSON(ctx, key);
    if (!transition) {
      throw new Error(`The transition ${transitionId} does not exist!`);
    }
    if (transition.owner !== ctx.clientIdentity.getMSPID()) {
      throw new Error(
        `Not authorized to modify transition ${transitionId} ${
          transition.owner
        } ${ctx.clientIdentity.getMSPID()}!`
      );
    }
    return ctx.stub.deleteState(key);
  }

  async CreateTransition(ctx, transitionId, functionURI, owner) {
    const key = ctx.stub.createCompositeKey(this.name, [
      'transition',
      transitionId,
    ]);
    const t = await getAssetJSON(ctx, key);
    if (t) {
      return t;
    }
    const transition = {
      id: transitionId,
      issuer: ctx.clientIdentity.getID(),
      owner: owner || ctx.clientIdentity.getMSPID(),
      action: {
        type: 'nl.dl4ld.actorAction',
        uri: functionURI,
      },
      status: 'READY',
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(transition)));
    return transition;
  }

  async CreateWebhookTransition(ctx, transitionId, webhookURI, headers, owner) {
    const key = ctx.stub.createCompositeKey(this.name, [
      'transition',
      transitionId,
    ]);
    const t = await getAssetJSON(ctx, key);
    if (t) {
      return t;
    }
    const transition = {
      id: transitionId,
      issuer: ctx.clientIdentity.getID(),
      owner: owner || ctx.clientIdentity.getMSPID(),
      action: {
        type: 'nl.dl4ld.webhook',
        uri: webhookURI,
        headers: headers,
      },
      status: 'READY',
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(transition)));
    return transition;
  }

  async CreateFunctionTransition(
    ctx,
    transitionId,
    functionName,
    params,
    owner
  ) {
    const key = ctx.stub.createCompositeKey(this.name, [
      'transition',
      transitionId,
    ]);
    const t = await getAssetJSON(ctx, key);
    if (t) {
      return t;
    }
    const transition = {
      id: transitionId,
      issuer: ctx.clientIdentity.getID(),
      owner: owner || ctx.clientIdentity.getMSPID(),
      action: {
        type: 'nl.dl4ld.function',
        functionName: functionName,
        params: params,
      },
      status: 'READY',
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(transition)));
    return transition;
  }

  async GetTransition(ctx, transitionId) {
    const key = ctx.stub.createCompositeKey(this.name, [
      'transition',
      transitionId,
    ]);
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
      data: data,
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

  // DeleteAsset deletes a given asset from the world state.
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
      const strValue = Buffer.from(result.value.value.toString()).toString(
        'utf8'
      );
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
