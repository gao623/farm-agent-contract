const { expectRevert, time } = require('@openzeppelin/test-helpers');
const AgentMiner = artifacts.require('AgentMiner');
const HelpDelegate = artifacts.require('HelpDelegate');
const ZooToken = artifacts.require('ZooToken');
const ZooKeeperFarming = artifacts.require('ZooKeeperFarming');
const MockERC20 = artifacts.require('MockERC20');
const BoostingDelegate = artifacts.require('BoostingDelegate');
const ZooNFT = artifacts.require('ZooNFT');
const WaspToken = artifacts.require('WaspToken');
const WanSwapFarm = artifacts.require('WanSwapFarm');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const assert = require('assert');
const sleep = require('ko-sleep');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const dualFarmingEnable = true;
const withPoolUpdate = true;
const nftTokenID1 = 1;
const nftTokenID2 = 2;
const nftTokenID3 = 3;
// const nftTokenID4 = 4;

contract('AgentZooKeeperFarming', ([alice, bob, carol, zooDev, agentDev, minter]) => {
  let agent;
  let help;
  let zoo;
  let nft;
  let boosting;
  let zooFarm;
  let wasp;
  let wanswapFarm;
  let lp1;
  let lp2;
  let lp3;
  let lp4;

  beforeEach(async () => {
    zoo = await ZooToken.new();
    await zoo.mint(alice, '1000000');
    await zoo.mint(bob, '1000000');
    await zoo.mint(carol, '1000000');
    await zoo.mint(zooDev, '1000000');
    await zoo.mint(minter, '1000000');

    lp1 = await MockERC20.new('LP', 'LP', 18, 10000000);
    lp2 = await MockERC20.new('LP', 'LP', 18, 10000000);
    lp3 = await MockERC20.new('LP', 'LP', 18, 10000000);
    lp4 = await MockERC20.new('LP', 'LP', 18, 10000000);

    boosting = await BoostingDelegate.new();
    await boosting.initialize(alice);

    nft = await ZooNFT.new();
    await nft.initialize(zooDev);
    await nft.setNFTFactory(alice, {from: zooDev});
    await nft.setNFTFactory(bob, {from: zooDev});
    // ------
    let pr =[];
    for (let i=1; i<=4; i++) {
      for (let c=1; c<=6; c++) {
        for (let e=1; e<=5; e++) {
          pr.push(Number(Number((await nft.getLevelChance(i, c, e)).toString())/1e10).toFixed(5));
        }
      }
    }

    let pn = uniqueArray(pr.sort().reverse());

    let chances = [];
    let boosts = [];
    let reduces = [];
    for(let i=0; i < pn.length; i++) {
      chances.push('0x' + Number((pn[i]*1e10).toFixed(0)).toString(16));
      boosts.push('0x' + Number(((i+1)*1e10).toFixed(0)).toString(16));
      reduces.push('0x' + Number((1e10 + i*2e9).toFixed(0)).toString(16));
    }

    // console.log("chances:", chances);
    // console.log("boosts:", boosts);
    // console.log("reduces:", reduces);
    await nft.setBoostMap(chances, boosts, reduces, {from: zooDev});
    // ------

    await nft.setBaseURI('https://gateway.pinata.cloud/ipfs/', {from: zooDev});
    await nft.setNftURI(1, 1, 1, 'QmZ7ddzc9ZFF4dsZxfYhu26Hp3bh1Pq2koxYWkBY6vbeoN/apple.json', {from: zooDev});
    await nft.setNftURI(2, 1, 1, 'QmZ7ddzc9ZFF4dsZxfYhu26Hp3bh1Pq2koxYWkBY6vbeoN/apple.json', {from: zooDev});
    await nft.setNftURI(3, 1, 1, 'QmZ7ddzc9ZFF4dsZxfYhu26Hp3bh1Pq2koxYWkBY6vbeoN/apple.json', {from: zooDev});
    await nft.mint(nftTokenID1, 1, 1, 1, 100, {from: alice});
    await nft.mint(nftTokenID2, 2, 2, 1, 100, {from: alice});
    await nft.mint(nftTokenID3, 3, 1, 1, 100, {from: bob});
    // await nft.mint(nftTokenID4, 4, 1, 1, 100, {from: bob});

    wasp = await WaspToken.new();
    wanswapFarm = await WanSwapFarm.new(
      wasp.address,
      zooDev,
      200,
      0,
      0,
      0,
      999999
    );
    await wasp.transferOwnership(wanswapFarm.address);
    // console.log("config wan wasp farm")

    // await wanswapFarm.add(100, lp1.address, true);
    // await wanswapFarm.add(100, lp2.address, true);
    // console.log("wan wasp add pool")

    zooFarm = await ZooKeeperFarming.new(
      zoo.address,
      zooDev,
      boosting.address,
      200,
      0,
      99999,
      wanswapFarm.address,
      wasp.address
    );
    // console.log("deploy zookeeper:", zooFarm.address);

    await boosting.setFarmingAddr(zooFarm.address);
    await boosting.setNFTAddress(nft.address);
    await boosting.setBoostScale(8 * 3600 * 24, '2000000000', '4000000000');
    // await nft.setApprovalForAll(boosting.address, true, { from: alice });
    // await nft.setApprovalForAll(boosting.address, true, { from: bob });

    await zoo.transferOwnership(zooFarm.address);
    // console.log("config boosting")

    // await zooFarm.add(100, lp1.address, true, 0, true);
    // await zooFarm.add(100, lp2.address, true, 1, false);
    // console.log("zookeeper add pool")

    help = await HelpDelegate.new();

    // var ownerBalance = await web3.eth.getBalance(alice);
    // // console.log("before deploy AgentMiner, owner balance:", ownerBalance);
    var gas = await AgentMiner.new.estimateGas(zooFarm.address, agentDev, help.address);
    // console.log("AgentMiner estimate gas:", gas, (await web3.eth.getBalance(alice)));
    agent = await AgentMiner.new(zooFarm.address, agentDev, help.address);
    // console.log("deploy agent")
    await nft.setApprovalForAll(agent.address, true, { from: alice });
    await nft.setApprovalForAll(agent.address, true, { from: bob });

    await lp1.transfer(bob, '1000000');
    await lp1.approve(agent.address, '1000000', {from: alice});
    await lp1.approve(agent.address, '1000000', {from: bob});

    await lp2.transfer(carol, '1000000');
    await lp2.transfer(zooDev, '1000000');
    await lp2.approve(agent.address, '1000000', {from: carol});
    await lp2.approve(agent.address, '1000000', {from: zooDev});

    await lp3.transfer(minter, '1000000');
    await lp3.transfer(zooDev, '1000000');
    await lp3.approve(agent.address, '1000000', {from: minter});
    await lp3.approve(agent.address, '1000000', {from: zooDev});

    await lp4.transfer(bob, '1000000');
    await lp4.approve(agent.address, '1000000', {from: alice});
    await lp4.approve(agent.address, '1000000', {from: bob});    

    // console.log("farm agent", agent.address);
    // console.log("wasp farming", wanswapFarm.address);
    // console.log("zoo farming", zooFarm.address);
    // console.log("boosting", boosting.address);
    // console.log("wasp", wasp.address);
    // console.log("zoo", zoo.address);
    // console.log("nft", nft.address);
    // console.log("lp1", lp1.address);
    // console.log("lp2", lp2.address);
    // console.log("lp3", lp3.address);
    // console.log("lp1", lp4.address);
    // console.log("alice", alice);
    // console.log("bob", bob);
    // console.log("carol", carol);
    // console.log("zooDev", zooDev);
    // console.log("agentDev", agentDev);
    // console.log("minter", minter);
  });

  it("should success when transferOwner", async ()=>{
    await agent.transferOwnership(agentDev);
  });

  it("should failed when transferOwner without access", async ()=>{
    try {
      await agent.transferOwnership(agentDev, {from: agentDev});
      assert.fail('never go here');
    } catch (e) {
      assert.ok(e.message.match(/revert/));
    }
  });

  it("should failed when add invalid pool", async ()=>{
    let zooPid = 0;
    try {
      await agent.add(zooPid, {from: bob});
    } catch (err) {
      assert.ok(err.message.match(/invalid pid/));
    }
  });

  it("should success when add pool", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    let receipt = await agent.add(zooPid, {from: bob});
    assert.strictEqual(receipt.logs[0].event, "LoadPool", "invalid event");
    assert.strictEqual(receipt.logs[0].args.farm, (await agent.zooKeeperFarming()), "invalid pool");
    assert.strictEqual(receipt.logs[0].args.zooPid.toString(10), zooPid.toString(10), "invalid pool id");
    // console.log("receipt:", JSON.stringify(receipt));
  });

  it("should success when deposit 0", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 0, 0, {from: bob});
  });

  it("should success when deposit amount", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
  });

  it("should success when single pendingZoo", async ()=>{
    // console.log("before:", await web3.eth.getBlockNumber())
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    // let zooPid1 = addZooKeeperFarmPool(wanswapFarm, zooFarm, 100, lp2address, true, false);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    // await agent.deposit(zooPid1, 100, 0, {from: carol});
    await time.advanceBlock();
    // console.log("after:", await web3.eth.getBlockNumber())
    // console.log("pendingZoo 1:", (await agent.pendingZoo(zooPid1, carol)).toString());
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');
    // assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '100');
    // assert.strictEqual((await agent.pendingZoo(zooPid1, carol)).toString(), '100');
    // console.log("wasp 1", (await agent.pendingWasp(zooPid1, carol)).toString())
    // assert.strictEqual((await agent.pendingWasp(zooPid1, bob)).toString(), '10');
  });

  it("should success when pendingZoo", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');
  });

  it("should success when withdraw 0", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(bob);

    await agent.withdraw(zooPid, 0, 0);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await time.advanceBlock();
    await agent.withdraw(zooPid, 0, 0, {from: bob});

    let afterZooBalance = await zooToken.balanceOf(bob);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '400', "invalid zoo amount");
  });

  it("should success when withdraw amount", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(bob);

    await agent.deposit(zooPid, 100, 0, {from: bob});
    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '999900', "invalid balance after deposit");
    await agent.withdraw(zooPid, 100, 0, {from: bob});
    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '1000000', "invalid balance after withdraw");

    let afterZooBalance = await zooToken.balanceOf(bob);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '200', "invalid zoo amount");
  });

  it("should success when deposit amount", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(10), '200', "invalid deposit 1 pending zoo");
    await agent.deposit(zooPid, 100, 0, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(10), '400', "invalid deposit 2 pending zoo");
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(10), '100', "invalid user 1 pending zoo");
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(10), '500', "invalid user 2 pending zoo");
  });

  it("should success when multi pool farming 1", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    let zooPid2 = await addZooKeeperSingleFarmPool(zooFarm, 100, lp2.address, withPoolUpdate);

    await agent.deposit(zooPid, 100, 0, {from: bob});
    await agent.deposit(zooPid2, 100, 0, {from: carol});
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '100');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '100');
    assert.strictEqual((await agent.pendingWasp(zooPid2, carol)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '300');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '200');
    assert.strictEqual((await agent.pendingWasp(zooPid2, carol)).toString(), '0');
  });

  it("should success when multi pool agent 2", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    let zooPid2 = await addZooKeeperSingleFarmPool(zooFarm, 400, lp2.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await agent.deposit(zooPid2, 100, 0, {from: carol});
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '40');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '80');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '160');
    assert.strictEqual((await agent.pendingWasp(zooPid2, carol)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '120');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '320');
    assert.strictEqual((await agent.pendingWasp(zooPid2, carol)).toString(), '0');
  });


  it("should success when deposit 0 with dual farming agent", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 0, 0, {from: bob});
  });

  it("should success when deposit amount with dual agent", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
  });

  it("should success when pendingZoo with dual agent", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(0, bob)).toString(), '200');
    assert.strictEqual((await agent.pendingWasp(0, bob)).toString(), '200');
  });

  it("should success when dual pendingZoo", async ()=>{
    // console.log("before:", await web3.eth.getBlockNumber())
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    // let zooPid1 = addZooKeeperFarmPool(wanswapFarm, zooFarm, 100, lp2address, true, false);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    // await agent.deposit(zooPid1, 100, 0, {from: carol});
    await time.advanceBlock();
    // console.log("after:", await web3.eth.getBlockNumber())
    // console.log("pendingZoo 1:", (await agent.pendingZoo(zooPid1, carol)).toString());
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '200');
    // assert.strictEqual((await agent.pendingZoo(zooPid1, carol)).toString(), '100');
    // console.log("wasp 1", (await agent.pendingWasp(zooPid1, carol)).toString())
    // assert.strictEqual((await agent.pendingWasp(zooPid1, bob)).toString(), '10');
  });

  it("should success when dual withdraw 0", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(bob);
    // console.log("beforeZooBalance:", await zooToken.balanceOf(bob), bob)

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(bob);
    // console.log("beforeWaspBalance:", await waspToken.balanceOf(bob), bob)

    let withDrawZeroReceipt = await agent.withdraw(zooPid, 0, 0);
    // console.log("withDrawZeroReceipt", JSON.stringify(withDrawZeroReceipt));
    // console.log("before deposit, block number:", await web3.eth.getBlockNumber())
    let deposit100 = await agent.deposit(zooPid, 100, 0, {from: bob});
    // console.log("deposit100", JSON.stringify(deposit100));
    await time.advanceBlock();
    let withDrawReceipt = await agent.withdraw(zooPid, 0, 0, {from: bob});

    let afterZooBalance = await zooToken.balanceOf(bob);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '400', "invalid zoo amount");
    // console.log("afterZooBalance:", await zooToken.balanceOf(bob), bob)

    let afterWaspBalance = await waspToken.balanceOf(bob);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    // console.log("afterWaspBalance:", await waspToken.balanceOf(bob), bob)
    assert.strictEqual(deltaWaspBalance.toString(10), '400', "invalid wasp amount");
    // console.log("before withdraw, block number:", await web3.eth.getBlockNumber())
    // console.log("withDrawReceipt", JSON.stringify(withDrawReceipt));
    // console.log(await web3.eth.)
  });

  it("should success when dual withdraw amount", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(bob);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(bob);

    await agent.deposit(zooPid, 100, 0, {from: bob});
    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '999900', "invalid balance after deposit");
    await agent.withdraw(zooPid, 100, 0, {from: bob});
    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '1000000', "invalid balance after withdraw");

    let afterZooBalance = await zooToken.balanceOf(bob);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '200', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(bob);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '200', "invalid wasp amount");
  });

  it("should success when dual deposit amount", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(10), '200', "invalid deposit 1 pending zoo");
    await agent.deposit(zooPid, 100, 0, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(10), '400', "invalid deposit 2 pending zoo");
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(10), '100', "invalid user 1 pending zoo");
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(10), '500', "invalid user 2 pending zoo");
  });

  it("should success when dual multi pool farming 1", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    let zooPid2 = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp2.address, withPoolUpdate);

    await agent.deposit(zooPid, 100, 0, {from: bob});
    await agent.deposit(zooPid2, 100, 0, {from: carol});
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '100');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '100');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '100');
    assert.strictEqual((await agent.pendingWasp(zooPid2, carol)).toString(), '100');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '300');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '300');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '200');
    assert.strictEqual((await agent.pendingWasp(zooPid2, carol)).toString(), '200');
  });

  it("should success when dual multi pool agent 2", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    let zooPid2 = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 400, lp2.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await agent.deposit(zooPid2, 100, 0, {from: carol});
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '40');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '80');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '160');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '120');
    assert.strictEqual((await agent.pendingZoo(zooPid2, carol)).toString(), '320');
  });

  it("should success when deposit 0 with NFT", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 0, lp1.address, withPoolUpdate);

    await agent.deposit(zooPid, 0, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());
  });

  it("should success when deposit amount with NFT", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), boosting.address.toLowerCase());
  });

  it("should success when deposit 0 no nft to nft", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 100;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    await time.advanceBlock();
    let pureReward = await agent.pendingZoo(zooPid, alice);
    assert.strictEqual(pureReward.toString(), '200');
    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());
    await time.advanceBlock();

    // let boostMultiplier = await boosting.getMultiplier(zooPid, agent.address);
    // let maxBoostMultiplier = await zooFarm.maxMultiplier();
    // console.log("boostMultiplier:", boostMultiplier, "maxBoostMultiplier:", maxBoostMultiplier)
    // boostMultiplier = (boostMultiplier.gt(maxBoostMultiplier)) ? maxBoostMultiplier : boostMultiplier;
    // console.log("boostMultiplier:", boostMultiplier, "reward-pure", pureReward);
    // let totalReward = pureReward.mul(boostMultiplier).div(new web3.utils.BN(1e12));
    // console.log("totalReward:", totalReward);
    // let userAmount = await agent.userInfo(zooPid, alice);
    // let userReward = userAmount.mul(totalReward).div(new web3.utils.BN(depositAmount))

    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215'); // 200(no nft) + 10(lp) + 5(nft)
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5'); // 5(dev)
    assert.strictEqual((await agent.devZoo()).toString(), '0'); // pending 5
  });

  it("should success when deposit amount no nft to nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    await agent.deposit(zooPid, 1000, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215'); // 200(common) + 10(lp) + 5(nft)
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5'); // 5(dev)

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '400', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when withdraw 0 with nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215'); // 200(common) + 10(lp) + 5(nft)
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5'); // 5(dev)
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '430'); // (200(common) + 10(lp) + 5(nft)) * 2
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '10'); // 5(dev) * 2

    await agent.withdraw(zooPid, 0, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.devZoo()).toString(), '0');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '645', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");

    // let pendingZooDetails = await agent.pendingZooDetail(zooPid, alice);
    // console.log("agent zoo pend details => userPending:", pendingZooDetails.userPending.toString(10), "nftOwnerPending:", pendingZooDetails.nftOwnerPending.toString(10), "devPending:", pendingZooDetails.devPending.toString(10), "lpPending:", pendingZooDetails.lpPending.toString(10))

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '15', "invalid dev zoo amount");
  });

  it("should success when withdraw amount with nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215'); // 200(common) + 10(lp) + 5(nft)
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5'); // 5(dev)
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '430'); // (200(common) + 10(lp) + 5(nft)) * 2
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '10'); // 5(dev) * 2
    await agent.withdraw(zooPid, depositAmount, 1, {from: alice});
    // console.log("withdraw receipt:", JSON.stringify(await agent.withdraw(zooPid, depositAmount, 1, {from: alice})));
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '645', "invalid zoo amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '15', "invalid dev zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when dual deposit 0 with NFT", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);

    await agent.deposit(zooPid, 0, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());
  });

  it("should success when dual deposit amount with NFT", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), boosting.address.toLowerCase());
  });

  it("should success when dual deposit 0 no nft to nft", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 100;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());
    await time.advanceBlock();

    // let boostMultiplier = await boosting.getMultiplier(zooPid, agent.address);
    // let maxBoostMultiplier = await zooFarm.maxMultiplier();
    // console.log("boostMultiplier:", boostMultiplier, "maxBoostMultiplier:", maxBoostMultiplier)
    // boostMultiplier = (boostMultiplier.gt(maxBoostMultiplier)) ? maxBoostMultiplier : boostMultiplier;
    // console.log("boostMultiplier:", boostMultiplier, "reward-pure", pureReward);
    // let totalReward = pureReward.mul(boostMultiplier).div(new web3.utils.BN(1e12));
    // console.log("totalReward:", totalReward);
    // let userAmount = await agent.userInfo(zooPid, alice);
    // let userReward = userAmount.mul(totalReward).div(new web3.utils.BN(depositAmount))

    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
  });

  it("should success when dual deposit amount no nft to nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    await agent.deposit(zooPid, 1000, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '400', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '400', "invalid wasp amount");
  });

  it("should success when dual withdraw 0 with nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '430');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '10');
    await agent.withdraw(zooPid, 0, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '645', "invalid zoo amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '15', "invalid dev zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '600', "invalid wasp amount");
  });

  it("should success when dual withdraw amount with nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '430');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '10');
    await agent.withdraw(zooPid, depositAmount, 1, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '645', "invalid zoo amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '15', "invalid dev zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '600', "invalid wasp amount");
  });

  it("should success when dual withdraw amount with nft about multi-participator", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.agentPool(zooPid)).nftOwner.toLowerCase(), alice.toLowerCase());

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, depositAmount, 0, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '530'); // 210 + 210 + 100(common) + 20*0.25(nft) + 20*0.50*1000/(1000 + 1000)(lp)
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '105');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.withdraw(zooPid, depositAmount, 1, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '210');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '650', "invalid zoo amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '20', "invalid dev zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '600', "invalid wasp amount");

    await agent.withdraw(zooPid, depositAmount, 0, {from: bob});
    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '410', "invalid bob zoo amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '400', "invalid wasp amount");
  });

  it("should success when deposit 0 with self NFT PK", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 0, lp1.address, withPoolUpdate);

    await agent.deposit(zooPid, 0, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());

    let canReplacePoolNFT = await agent.canReplacePoolNFT(zooPid, nftTokenID2);
    assert.strictEqual(canReplacePoolNFT, true);

    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());
  });

  it("should success when deposit amount with self NFT PK", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), boosting.address.toLowerCase());
    assert.strictEqual((await boosting.userInfo(zooPid, agent.address)).tokenId.toNumber(), nftTokenID1);
    // console.log("nft", nftTokenID1, "boosting:", (await nft.getBoosting(nftTokenID1)).toString())

    let canReplacePoolNFT = await agent.canReplacePoolNFT(zooPid, nftTokenID2);
    assert.strictEqual(canReplacePoolNFT, true);

    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());
    assert.strictEqual((await boosting.userInfo(zooPid, agent.address)).tokenId.toNumber(), nftTokenID2);
    // console.log("nft", nftTokenID2, "boosting:", (await nft.getBoosting(nftTokenID2)).toString())
  });

  it("should success when deposit amount with other NFT PK", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    await agent.deposit(zooPid, 100, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), boosting.address.toLowerCase());
    assert.strictEqual((await boosting.userInfo(zooPid, agent.address)).tokenId.toNumber(), nftTokenID1);
    // console.log("nft", nftTokenID1, "boosting:", (await nft.getBoosting(nftTokenID1)).toString())

    let canReplacePoolNFT = await agent.canReplacePoolNFT(zooPid, nftTokenID3);
    assert.strictEqual(canReplacePoolNFT, true);

    await agent.deposit(zooPid, 0, nftTokenID3, {from: bob});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());
    assert.strictEqual((await nft.ownerOf(nftTokenID3)).toLowerCase(), boosting.address.toLowerCase());
    assert.strictEqual((await boosting.userInfo(zooPid, agent.address)).tokenId.toNumber(), nftTokenID3);
    // console.log("nft", nftTokenID3, "boosting:", (await nft.getBoosting(nftTokenID3)).toString())
  });

  it("should success when deposit 0 no nft to nft PK", async ()=>{    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice}); // zoo reward +20, transfer to alice 400 zoo
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215'); // 200(common) + 10(lp) + 5(nft)
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    let canReplacePoolNFT = await agent.canReplacePoolNFT(zooPid, nftTokenID3);
    assert.strictEqual(canReplacePoolNFT, true);

    // nftTokenID2 --- 220
    // nftTokenID3 --- 250
    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // zoo reward +50, transfer 10 zoo to old nft owner(alice)
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420'); // 210 + 200(common) + 10(lp)
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), alice.toLowerCase());
    assert.strictEqual((await nft.ownerOf(nftTokenID3)).toLowerCase(), boosting.address.toLowerCase());

    await time.advanceBlock();
    // total reward is 250, alice pure reward is 100, bob pure reward is 100, total pure nft reward is 50, 12(50 *25%) is team reward, 12(50 *25%) is nft owner reward, then left reward 26 is lp reward, alice total reward is 100 + 26 / 2, bob total reward is 100 + 26 / 2 + 12
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '533'); // 420 + 100 + 13
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + 13 + 12
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12'); // 12

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '410', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when deposit amount no nft to nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    await time.advanceBlock();
    // console.log("1 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    // console.log("2 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    // console.log("3 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, depositAmount*2, nftTokenID3, {from: bob}); // +50  nft reward(40) transfer to nft owner
    // console.log("4 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420'); // 210 + 210
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), alice.toLowerCase());
    assert.strictEqual((await nft.ownerOf(nftTokenID3)).toLowerCase(), boosting.address.toLowerCase());
    await time.advanceBlock();

    // total reward is 250, alice pure reward is 100, bob pure reward is 100, total pure nft reward is 50, 12(50 *25%) is team reward, 12(50 *25%) is nft owner reward, then left reward 26 is lp reward, alice total reward is 100 + 26 / 2, bob total reward is 100 + 26 / 2 + 12
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '533'); // 210 + 210 + 100 + 26/2
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + 12 + 26/2
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '410', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when withdraw 0 with nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice}); // +20
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420'); // 10 nft reward transfer to alice while deposit
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '533'); // 420 + 100 + 26 / 2
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + 12 + 26/2
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12');

    await agent.withdraw(zooPid, 0, 0, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '645'); // 420 + 100 + 100 + [lp](50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '10', "invalid alice zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid alice wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '250', "invalid bob zoo amount"); // 100 + 100 + [lp](50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2 + [nft](50 * 2 * 0.25)

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid bob wasp amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '35', "invalid dev zoo amount"); // 10 + [nft](50 * 2 * 0.25)
  });

  it("should success when withdraw amount with nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice}); // +20
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420'); // 10 nft reward transfer to alice while deposit
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0'); // 10 team reward transfer to dev while deposit
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '533'); // 420 + 100 + 26 / 2
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + 12 + 26/2
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12');

    await agent.withdraw(zooPid, depositAmount, 1, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '645'); // 420 + 100 + 100 + [lp](50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '10', "invalid alice zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid alice wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '250', "invalid bob zoo amount"); // 100 + 100 + [lp](50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2 + [nft](50 * 2 * 0.25)

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid bob wasp amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '35', "invalid dev zoo amount"); // 10 + [nft](50 * 2 * 0.25)

    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '1000000', "invalid balance after withdraw");
  });

  it("should success when deposit amount no nft to nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice}); // 400 transfer to alice
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, depositAmount, 0, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '530'); // 420 + 100 + [lp]5 + [nft]5
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '105'); // 100 + [lp]5
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, 0, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '630'); // 420 + 100 + [lp]5 + 100 + [lp]5
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '743'); // 630 + 100 + [lp](26/2)
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + [lp](26/2) + [nft](12)
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '420', "invalid alice zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid alice wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '210', "invalid bob zoo amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid bob wasp amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '20', "invalid dev zoo amount");
  });

  it("should success when withdraw amount with nft 3", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob});
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '238');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12');
  });

  it("should success when dual withdraw amount with nft PK about multi-participator", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice}); // +20
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.agentPool(zooPid)).nftOwner.toLowerCase(), alice.toLowerCase());
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
    // console.log("nft", nftTokenID2, "owner:", (await nft.ownerOf(nftTokenID2)), "boosting:", (await nft.getBoosting(nftTokenID2)).toString(), "boost-address:", boosting.address);
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    // console.log("alice pending zoo:", (await agent.pendingZoo(zooPid, alice)).toString());
    // console.log("bob pending zoo:", (await agent.pendingZoo(zooPid, bob)).toString());
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420'); // nft reward (10) transfer to nft owner while nft updated
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    // console.log("alice pending zoo:", (await agent.pendingZoo(zooPid, alice)).toString());
    // console.log("bob pending zoo:", (await agent.pendingZoo(zooPid, bob)).toString());
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '533'); // 420 + 100 + [lp](26/2)
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + [lp](26/2) + [nft]12
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '500'); // 400 + 100
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '100');
    await agent.withdraw(zooPid, depositAmount, 1, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0'); // 420 + 100 + [lp](26/2) + [nft]12
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '225'); // 100 + 100 + [lp]((50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2)
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '655', "invalid alice zoo amount"); // 400 + 100 + 100 + [nft]10 + [lp](10 + 10 + 25)

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '25', "invalid bob zoo amount"); // nft reward

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '600', "invalid alice wasp amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid bob wasp amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '35', "invalid dev zoo amount"); // 10 + 25
  });

  it("should success when cancel nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.withdraw(zooPid, 0, 1, {from: alice});
    // await agent.removeNFT(zooPid, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');

    await agent.withdraw(zooPid, depositAmount, 1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '830', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '10', "invalid dev zoo amount"); // 10 + 25
  });

  it("should success when cancel nft about multi-participator", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);
    let beforeDevZooBalance = await zooToken.balanceOf(agentDev);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice}); // +20
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '420'); // nft reward 10 has been transfered to alice
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    let aliceZooBalance = await zooToken.balanceOf(alice);
    let aliceDeltaZooBalance = aliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(aliceDeltaZooBalance.toString(10), '10', "invalid nft reward");

    await time.advanceBlock();
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '533'); // 420 + 100 + [lp](26/2)
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '125'); // 100 + [lp](26/2) + 12
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '12');

    await agent.withdraw(zooPid, 0, 1, {from: bob});
    // await agent.removeNFT(zooPid, {from: bob});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '645'); // 420 + 100 + 100 + [lp](50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    let bobZooBalance = await zooToken.balanceOf(bob);
    let bobDeltaZooBalance = bobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(bobDeltaZooBalance.toString(10), '250', "invalid remove nft amount"); // 100 + 100 + [lp]((50 * 2 - (50 * 2 * 0.25) - (50 * 2 * 0.25)) / 2) + [nft](50 * 2 * 0.25)

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '745');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '100');

    await agent.withdraw(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');

    await agent.withdraw(zooPid, depositAmount, 0, {from: bob});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '1000000');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '855', "invalid 1 zoo amount"); // only alice(200 + 200 + 20 + 10) + with bob(100 + 100 + 25 + 100 + 100)

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid 1 wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '650', "invalid 2 zoo amount"); // bob nft(100 + 100 + 25 + 25) + with alice(100 + 100) + 200

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid 2 wasp amount");

    let afterDevZooBalance = await zooToken.balanceOf(agentDev);
    let deltaDevZooBalance = afterDevZooBalance.sub(beforeDevZooBalance)
    assert.strictEqual(deltaDevZooBalance.toString(10), '35', "invalid dev zoo amount"); // 10 + 25
  });

  it("should success when owner emergencyWithdraw by emergencyClaimPoolNFT without nft", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');

    await zooFarm.emergencyWithdrawEnable(zooPid);
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');

    await agent.emergencyClaimPoolNFT(zooPid, 0);
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), alice.toLowerCase());

    await agent.emergencyWithdrawEnable(zooPid, 0);
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), depositAmount.toString());

    await agent.emergencyWithdraw(zooPid, {from: alice});
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
  });

  it("should success when owner emergencyWithdraw by emergencyClaimPoolNFT with nft", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');

    await zooFarm.emergencyWithdrawEnable(zooPid);
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');

    await agent.emergencyClaimPoolNFT(zooPid, nftTokenID1);
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), alice.toLowerCase());
    await agent.emergencyWithdrawEnable(zooPid, 1);

    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), depositAmount.toString());

    await agent.emergencyWithdraw(zooPid, {from: alice});
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
  });

  it("should failed when user emergencyWithdraw without access", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '215');
    assert.strictEqual((await agent.pendingZoo(zooPid, agentDev)).toString(), '5');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');

    try {
      await agent.emergencyWithdrawEnable(zooPid, 1);
      assert.fail('never go here');
    } catch (e) {
      assert.ok(e.message.match(/not enable emergence mode/));
    }
    try {
      await agent.emergencyWithdraw(zooPid, {from: alice});
      assert.fail('never go here');
    } catch (e) {
      assert.ok(e.message.match(/disable emergence mode/));
    }
  });

});


async function addWanSwapFarmPool(wanSwapFarm, allocPoint, lpTokenAddress, withUpdate) {
  let waspPid = await wanSwapFarm.poolLength();
  await wanSwapFarm.add(allocPoint, lpTokenAddress, !!withUpdate);
  return waspPid;
}

async function addZooKeeperSingleFarmPool(zooKeeperFarm, allocPoint, lpTokenAddress, withUpdate) {
  let zooPid = await zooKeeperFarm.poolLength();
  await zooKeeperFarm.add(allocPoint, lpTokenAddress, !!withUpdate, 0, !dualFarmingEnable);
  return zooPid;
}

async function addZooKeeperDualFarmPool(wanSwapFarm, zooKeeperFarm, allocPoint, lpTokenAddress, withUpdate, waspPid) {
  if (typeof(waspPid) === "undefined") {
    waspPid = await addWanSwapFarmPool(wanSwapFarm, allocPoint, lpTokenAddress, !!withUpdate);
  }
  let zooPid = await zooKeeperFarm.poolLength();
  await zooKeeperFarm.add(allocPoint, lpTokenAddress, !!withUpdate, waspPid, dualFarmingEnable);
  return zooPid;
}

function uniqueArray (arr) {
  return Array.from(new Set(arr))
}
