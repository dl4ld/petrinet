# Petrinet Smart Contract

First get a fabric test network running by following th fabric online docs.

```
https://hyperledger-fabric.readthedocs.io/en/release-2.2/install.html
```

Install fabric samples to build a test network with 3 organizations

```
git clone git clone https://github.com/dl4ld/fabric-samples.git
```

Install petrinet smart contract and application in fabric-samples

```
cd fabric-samples
git clone git clone https://github.com/dl4ld/petrinet.git
```

Start test network with 3 organizations

```
cd fabric-samples/test-network3
./network.sh up createChannel -c mychannel -ca
```

Deploy Petrinet smart contract

```
./network.sh deployCC -ccn petrinet01 -ccp ~/fabric-samples/petrinet/chaincode-javascript/ -ccl javascript
```

Run organization clients

```
cd fabric-samples/petrinet/application-javascript/run_org3.sh petrinet01
cd fabric-samples/petrinet/application-javascript/run_org2.sh petrinet01
cd fabric-samples/petrinet/application-javascript/run_org1.sh petrinet01
```

Access web interface for each organization

```
http://localhost:9391
http://localhost:9291
http://localhost:9191
```

Install Kathara binary. Follow instructions https://www.kathara.org/

Install Kathara lab

```
git clone https://github.com/dl4ld/network-lab.git
```

Start lab

```
cd network-lab
kathara lstart
```

Start mqtt server

```
./start_mqtt.sh
```

Create control network

```
./create_control_network.sh
```

Connect nodes to control network

```
./connect_nodes_to_control_network.sh
```
