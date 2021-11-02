# Petrinet Smart Contract

First get a fabric test network running by following th fabric online docs.

Pull petrinet github repo.

Deploy the petrinet smart contract

```
cd [TEST-NETWORK FOLDER]
./network.sh deployCC -ccn petrinet01 -ccp [PETRINET-REPO-FOLDER]/chaincode-javascript/ -ccl javascript
```

Run the 2 domain applications in different terminals

```
cd [PETRINET-REPO-FOLDER]/application-javascript/
./run_org2.sh petrinet01
./run_org1.sh petrinet02
```

