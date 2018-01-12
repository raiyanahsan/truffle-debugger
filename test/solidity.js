import debugModule from "debug";
const debug = debugModule("test:solidity");

import { assert } from "chai";

import Ganache from "ganache-cli";
import Web3 from "web3";

import { prepareContracts } from "./helpers";
import Debugger from "../lib/debugger";

import solidity from "../lib/solidity/selectors";


const __SINGLE_CALL = `
pragma solidity ^0.4.18;

contract SingleCall {
  event Called();

  function run() public {
    Called();
  }
}
`;


const __NESTED_CALL = `
pragma solidity ^0.4.18;

contract NestedCall {
  event First();
  event Second();

  // run()
  //   first()    1
  //     inner()  2
  //       event  3
  //              2
  //   second     1
  //     event    2
  //              1
  function run() public {
    first();
    second();
  }

  function first() public {
    inner();
  }

  function inner() public {
    First();
  }

  function second() public {
    Second();
  }

}
`;


let sources = {
  "SingleCall.sol": __SINGLE_CALL,
  "NestedCall.sol": __NESTED_CALL,
}


describe("Solidity Debugging", function() {
  var provider;
  var web3;

  var abstractions;
  var artifacts;

  before("Create Provider", async function() {
    provider = Ganache.provider({seed: "debugger", gasLimit: 7000000});
    web3 = new Web3(provider);
  });

  before("Prepare contracts and artifacts", async function() {
    this.timeout(30000);

    let prepared = await prepareContracts(provider, sources)
    abstractions = prepared.abstractions;
    artifacts = prepared.artifacts;
  });

  describe("Function Depth", function() {
    it("remains at 1 in absence of inner function calls", async function() {
      const maxExpected = 1;

      let instance = await abstractions.SingleCall.deployed();
      let receipt = await instance.run();
      let txHash = receipt.tx;

      let bugger = await Debugger.forTx(txHash, {
        provider,
        contracts: artifacts
      });

      let session = bugger.connect();
      var stepped;  // session steppers return false when done

      do {
        stepped = session.stepNext();

        let actual = session.view(solidity.currentState.functionDepth);

        assert.isAtMost(actual, maxExpected);

      } while(stepped);

    });

    it("spelunks correctly", async function() {
      // prepare
      let instance = await abstractions.NestedCall.deployed();
      let receipt = await instance.run();
      let txHash = receipt.tx;

      let bugger = await Debugger.forTx(txHash, {
        provider,
        contracts: artifacts
      });

      let session = bugger.connect();

      // follow functionDepth values in list
      // see source above
      let expectedDepthSequence = [1,2,3,2,1,2,1,0];
      let actualSequence = [session.view(solidity.currentState.functionDepth)];

      var stepped;

      do {
        stepped = session.stepNext();

        let currentDepth = session.view(solidity.currentState.functionDepth);
        let lastKnown = actualSequence[actualSequence.length - 1];

        if (currentDepth !== lastKnown) {
          actualSequence.push(currentDepth);
        }
      } while(stepped);

      assert.deepEqual(actualSequence, expectedDepthSequence);
    });
  });
});