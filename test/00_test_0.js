const { singletons, expectRevert } = require("@openzeppelin/test-helpers");
const { expect, assert } = require("chai");
const { BigNumber } = require("ethers");
const util = require('util');

describe("Nix", function () {
  const NULLACCOUNT = "0x0000000000000000000000000000000000000000";
  let owner, user0, user1, ownerSigner, user0Signer, user1Signer, erc1820Registry, simpleERC721, nftA, weth, nix;
  const accounts = [];
  const accountNames = {};
  const contracts = [];

  function addAccount(account, accountName) {
    accounts.push(account);
    accountNames[account.toLowerCase()] = accountName;
    console.log("      Mapping " + account + " => " + getShortAccountName(account));
  }

  function getShortAccountName(address) {
    if (address != null) {
      var a = address.toLowerCase();
      var n = accountNames[a];
      if (n !== undefined) {
        return n + ":" + address.substring(0, 6);
      }
    }
    return address;
  }

  function printEvents(prefix, receipt) {
    console.log("      > " + prefix + " - gasUsed: " + receipt.gasUsed);
    receipt.logs.forEach((log) => {
      let found = false;
      for (let i = 0; i < contracts.length && !found; i++) {
        try {
          var data = contracts[i].interface.parseLog(log);
          var result = data.name + "(";
          let separator = "";
          data.eventFragment.inputs.forEach((a) => {
            result = result + separator + a.name + ": ";
            if (a.type == 'address') {
              result = result + getShortAccountName(data.args[a.name].toString());
            } else if (a.type == 'uint256' || a.type == 'uint128') {
              if (a.name == 'tokens' || a.name == 'amount' || a.name == 'balance' || a.name == 'value') {
                result = result + ethers.utils.formatUnits(data.args[a.name], 18);
              } else {
                result = result + data.args[a.name].toString();
              }
            } else {
              result = result + data.args[a.name].toString();
            }
            separator = ", ";
          });
          result = result + ")";
          console.log("        + " + getShortAccountName(log.address) + " " + log.blockNumber + "." + log.logIndex + " " + result);
          found = true;
        } catch (e) {
        }
      }
      if (!found) {
        console.log("      + " + getShortAccountName(log.address) + " " + JSON.stringify(log.topics));
      }
    });
  }

  function padLeft(s, n) {
    var o = s;
    while (o.length < n) {
      o = " " + o;
    }
    return o;
  }
  function padRight(s, n) {
    var o = s;
    while (o.length < n) {
      o = o + " ";
    }
    return o;
  }

  async function printBalances(prefix) {
    const totalSupply = await nftA.totalSupply();
    console.log("      --- " + prefix + " - ERC721 '" + await nftA.name() + "' '" + await nftA.symbol() + "' " + totalSupply + " ---");
    const owners = {};
    for (let i = 0; i < totalSupply; i++) {
      const ownerOf = await nftA.ownerOf(i);
      if (!owners[ownerOf]) {
        owners[ownerOf] = [];
      }
      owners[ownerOf].push(i);
    }
    console.log("        Owner                        WETH NFTA");
    var checkAccounts = [owner, user0, user1];
    for (let i = 0; i < checkAccounts.length; i++) {
      const ownerData = owners[checkAccounts[i]] || [];
      const wethBalance = weth == null ? 0 : await weth.balanceOf(checkAccounts[i]);
      console.log("        " + getShortAccountName(checkAccounts[i]) + " " + padLeft(ethers.utils.formatEther(wethBalance), 20) + " " + JSON.stringify(ownerData) + " ");
    }
  }

  async function printNixDetails(prefix) {
    const orderTypes = [ "BuyAny", "SellAny", "BuyAll", "SellAll" ];
    const orderStatuses = [ "Active", "Cancelled", "Executed", "NotExecutable" ];

    const ordersLength = await nix.ordersLength();
    console.log("    --- " + prefix + " - Nix - orders: " + ordersLength + " ---");
    console.log("           # Maker        Taker        Token                        WETH OrderType       Expiry                   Order Status Key        TokenIds");
    for (let i = 0; i < ordersLength; i++) {
      const order = await nix.getOrderByIndex(i);

      // console.log("        " + i + " " + JSON.stringify(order));
      const maker = order[0][0];
      const taker = order[0][1];
      const token = order[0][2];
      const tokenIds = order[0][3];
      const weth = order[0][4];
      const orderType = order[0][5];
      const expiry = order[0][6];
      const expiryString = expiry == 0 ? "(none)" : new Date(expiry * 1000).toISOString();
      const orderStatus = order[0][7];
      const orderKey = order[1];

      console.log("           " + padLeft(i, 3) + " " + padRight(getShortAccountName(maker), 12) + " " +
        padRight(getShortAccountName(taker), 12) + " " + padRight(getShortAccountName(token), 12) + " " +
        padLeft(ethers.utils.formatEther(weth), 20) + " " + padRight(orderTypes[orderType], 15) + " " +
        padRight(expiryString, 24) + " " +
        padRight(orderStatuses[orderStatus], 12) + " " +
        orderKey.substring(0, 10) + " " +
        JSON.stringify(tokenIds.map((x) => { return parseInt(x.toString()); })));
    }
  }


  before(async function () {
    [owner, user0, user1] = await web3.eth.getAccounts();
    [ownerSigner, user0Signer, user1Signer] = await ethers.getSigners();

    console.log("    --- Setup Accounts ---");
    addAccount("0x0000000000000000000000000000000000000000", "null");
    addAccount(owner, "owner");
    addAccount(user0, "user0");
    addAccount(user1, "user1");

    erc1820Registry = await singletons.ERC1820Registry(owner);
    addAccount(erc1820Registry.address, "ERC1820Registry");

    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const fixedSupply = ethers.utils.parseEther("300");
    weth = await TestERC20.deploy("WETH", "Wrapped ETH", 18, fixedSupply);
    await weth.deployed();
    contracts.push(weth);
    addAccount(weth.address, "WETH");
    const transferWeth0Tx = await weth.transfer(user0, ethers.utils.parseEther("100"));
    await printEvents("Transfer WETH", await transferWeth0Tx.wait());
    const transferWeth1Tx = await weth.transfer(user1, ethers.utils.parseEther("100"));
    await printEvents("Transfer WETH", await transferWeth1Tx.wait());

    const ERC721PresetMinterPauserAutoId  = await ethers.getContractFactory("ERC721PresetMinterPauserAutoId");
    nftA = await ERC721PresetMinterPauserAutoId.deploy("name", "symbol", "uri");
    contracts.push(nftA);
    addAccount(nftA.address, "NFT1");
    const nftATransactionReceipt = await nftA.deployTransaction.wait();
    await printEvents("Deployed NFT1", nftATransactionReceipt);

    const mint0Tx = await nftA.mint(owner);
    await printEvents("Minted NFT1", await mint0Tx.wait());
    const mint1Tx = await nftA.mint(user0);
    await printEvents("Minted NFT1", await mint1Tx.wait());
    const mint2Tx = await nftA.mint(user0);
    await printEvents("Minted NFT1", await mint2Tx.wait());
    const mint3Tx = await nftA.mint(user0);
    await printEvents("Minted NFT1", await mint3Tx.wait());

    const Nix = await ethers.getContractFactory("Nix");
    nix = await Nix.deploy();
    await nix.deployed();
    contracts.push(nix);
    addAccount(nix.address, "Nix");
    await printNixDetails("Nix Deployed");
  })


  it("Should return the new greeting once it's changed", async function () {

    const approveTx = await nftA.connect(user0Signer).setApprovalForAll(nix.address, true);
    printEvents("Approved Nix To Transfer", await approveTx.wait());
    console.log();
    await printBalances("After Maker Approve Nix To Transfer");
    console.log();

    const makerAddOrder1Tx = await nix.connect(user0Signer).makerAddOrder(
      NULLACCOUNT, // taker
      nftA.address, // token
      [ 1 ], // tokenIds
      ethers.utils.parseEther("12.3456"), // weth
      0, // orderType
      0, // expiry
    );
    await printEvents("Maker Added Order #0 - Sell NFT1:1 for 12.3456e", await makerAddOrder1Tx.wait());
    console.log();
    // await printNixDetails("After Approve And Maker Added Order #0");
    // console.log();

    const expiry2 = parseInt(new Date() / 1000) + (60 * 60 * 24);
    const makerAddOrder2Tx = await nix.connect(user0Signer).makerAddOrder(
      NULLACCOUNT, // taker
      nftA.address, // token
      [ ], // tokenIds
      ethers.utils.parseEther("1.23456"), // weth
      0, // orderType
      expiry2, // expiry
    );
    await printEvents("Maker Added Order #1 - Sell NFT1:* for 1.23456e", await makerAddOrder2Tx.wait());
    console.log();
    await printNixDetails("After Approve And Maker Added Order #1");

    const takerExecuteOrder1Tx = await nix.connect(user1Signer).takerExecuteOrder(0, [ 1 ], ethers.utils.parseEther("12.3456"));
    await printEvents("Taker Executed Order #1 - Buy NFT1:1 for 12.3456e", await takerExecuteOrder1Tx.wait());
    console.log();
    await printNixDetails("After Taker Executed Order #1");

    if (false) {
      const exchangeTx = await nix.connect(user0Signer).exchange(nftA.address, 1, user1);
      printEvents("Exchanged", await exchangeTx.wait());
      await printBalances("After Approve And Exchange =");
    }

    // expect(await nix.greet()).to.equal("Hello, world!");
    //
    // const setGreetingTx = await nix.setGreeting("Hola, mundo!");
    //
    // // wait until the transaction is mined
    // await setGreetingTx.wait();
    //
    // expect(await nix.greet()).to.equal("Hola, mundo!");
  });
});
