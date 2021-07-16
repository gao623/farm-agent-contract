const { expectRevert, time } = require('@openzeppelin/test-helpers');
const AgentMiner = artifacts.require('AgentMiner');
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

contract('AgentZooKeeperFarming', ([alice, bob, carol, dev, minter]) => {
  let agent;
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
    await zoo.mint(dev, '1000000');
    await zoo.mint(minter, '1000000');

    lp1 = await MockERC20.new('LP', 'LP', 18, 10000000);
    lp2 = await MockERC20.new('LP', 'LP', 18, 10000000);
    lp3 = await MockERC20.new('LP', 'LP', 18, 10000000);
    lp4 = await MockERC20.new('LP', 'LP', 18, 10000000);

    boosting = await BoostingDelegate.new();
    await boosting.initialize(alice);

    nft = await ZooNFT.new();
    await nft.initialize(dev);
    await nft.setNFTFactory(alice, {from: dev});
    await nft.setNFTFactory(bob, {from: dev});
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
    await nft.setBoostMap(chances, boosts, reduces, {from: dev});
    // ------

    await nft.setBaseURI('https://gateway.pinata.cloud/ipfs/', {from: dev});
    await nft.setNftURI(1, 1, 1, 'QmZ7ddzc9ZFF4dsZxfYhu26Hp3bh1Pq2koxYWkBY6vbeoN/apple.json', {from: dev});
    await nft.setNftURI(2, 1, 1, 'QmZ7ddzc9ZFF4dsZxfYhu26Hp3bh1Pq2koxYWkBY6vbeoN/apple.json', {from: dev});
    await nft.setNftURI(3, 1, 1, 'QmZ7ddzc9ZFF4dsZxfYhu26Hp3bh1Pq2koxYWkBY6vbeoN/apple.json', {from: dev});
    await nft.mint(nftTokenID1, 1, 1, 1, 100, {from: alice});
    await nft.mint(nftTokenID2, 2, 2, 1, 100, {from: alice});
    await nft.mint(nftTokenID3, 3, 1, 1, 100, {from: bob});
    // await nft.mint(nftTokenID4, 4, 1, 1, 100, {from: bob});

    wasp = await WaspToken.new();
    wanswapFarm = await WanSwapFarm.new(
      wasp.address,
      dev,
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
      dev,
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

    // var ownerBalance = await web3.eth.getBalance(alice);
    // // console.log("before deploy AgentMiner, owner balance:", ownerBalance);
    var gas = await AgentMiner.new.estimateGas(zooFarm.address, dev);
    // console.log("AgentMiner estimate gas:", gas, (await web3.eth.getBalance(alice)));
    agent = await AgentMiner.new(zooFarm.address, dev);
    // console.log("deploy agent")
    await nft.setApprovalForAll(agent.address, true, { from: alice });
    await nft.setApprovalForAll(agent.address, true, { from: bob });

    await lp1.transfer(bob, '1000000');
    await lp1.approve(agent.address, '1000000', {from: alice});
    await lp1.approve(agent.address, '1000000', {from: bob});

    await lp2.transfer(carol, '1000000');
    await lp2.transfer(dev, '1000000');
    await lp2.approve(agent.address, '1000000', {from: carol});
    await lp2.approve(agent.address, '1000000', {from: dev});

    await lp3.transfer(minter, '1000000');
    await lp3.transfer(dev, '1000000');
    await lp3.approve(agent.address, '1000000', {from: minter});
    await lp3.approve(agent.address, '1000000', {from: dev});

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
    // console.log("dev", dev);
    // console.log("minter", minter);
  });

  it("should success when transferOwner", async ()=>{
    await agent.transferOwnership(dev);
  });

  it("should failed when transferOwner without access", async ()=>{
    try {
      await agent.transferOwnership(dev, {from: dev});
      assert.fail('never go here');
    } catch (e) {
      assert.ok(e.message.match(/revert/));
    }
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

    await agent.withdraw(zooPid, 0);
    await agent.deposit(zooPid, 100, 0, {from: bob});
    await time.advanceBlock();
    await agent.withdraw(zooPid, 0, {from: bob});

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
    await agent.withdraw(zooPid, 100, {from: bob});
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

    let withDrawZeroReceipt = await agent.withdraw(zooPid, 0);
    // console.log("withDrawZeroReceipt", JSON.stringify(withDrawZeroReceipt));
    // console.log("before deposit, block number:", await web3.eth.getBlockNumber())
    let deposit100 = await agent.deposit(zooPid, 100, 0, {from: bob});
    // console.log("deposit100", JSON.stringify(deposit100));
    await time.advanceBlock();
    let withDrawReceipt = await agent.withdraw(zooPid, 0, {from: bob});

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
    await agent.withdraw(zooPid, 100, {from: bob});
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

    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
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
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

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

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    await time.advanceBlock();
    await agent.withdraw(zooPid, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '660', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when withdraw amount with nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    await time.advanceBlock();
    await agent.withdraw(zooPid, depositAmount, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '660', "invalid zoo amount");

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

    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
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
    await agent.deposit(zooPid, 1000, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

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

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    await time.advanceBlock();
    await agent.withdraw(zooPid, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '660', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '600', "invalid wasp amount");
  });

  it("should success when dual withdraw amount with nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    await time.advanceBlock();
    await agent.withdraw(zooPid, depositAmount, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '660', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '600', "invalid wasp amount");
  });

  it("should success when dual withdraw amount with nft about multi-participator", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await agent.agentPool(zooPid)).nftOwner.toLowerCase(), alice.toLowerCase());
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount, 0, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '440');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '554');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '104');
    await agent.withdraw(zooPid, depositAmount, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '669', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '600', "invalid wasp amount");
  });

  it("should success when deposit 0 with self NFT PK", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 0, lp1.address, withPoolUpdate);

    await agent.deposit(zooPid, 0, nftTokenID1, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.ownerOf(nftTokenID1)).toLowerCase(), alice.toLowerCase());

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
    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50  nft reward(40) transfer to nft owner
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '400'); // 200 + 200
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), alice.toLowerCase());
    assert.strictEqual((await nft.ownerOf(nftTokenID3)).toLowerCase(), boosting.address.toLowerCase());
    await time.advanceBlock();

    // total reward is 250, alice pure reward is 100, bob pure reward is 125, then left reward is 25, dev reward is 25 * 10%, then left reward is 22, alice total reward is 100 + 11, bob total reward is 125 + 11
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '511'); // 200 + 200 + 111
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136'); // 136

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '440', "invalid zoo amount");

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
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    // console.log("2 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    // console.log("3 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount*2, nftTokenID3, {from: bob}); // +50  nft reward(40) transfer to nft owner
    // console.log("4 alice", alice, (await zooToken.balanceOf(alice)), "bob", bob, (await zooToken.balanceOf(bob)), "nft owner", (await agent.agentPool(zooPid)).nftOwner, (await agent.agentPool(zooPid)).nftUserZooReward)
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '400'); // 200 + 200
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), alice.toLowerCase());
    assert.strictEqual((await nft.ownerOf(nftTokenID3)).toLowerCase(), boosting.address.toLowerCase());
    await time.advanceBlock();

    // total reward is 250, alice pure reward is 100, bob pure reward is 125, then left reward is 25, dev reward is 25 * 10%, then left reward is 22, alice total reward is 100 + 11, bob total reward is 125 + 11
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '511'); // 200 + 200 + 111
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136'); // 136

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '440', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when withdraw 0 with nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice}); // +20
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '400'); // 40 nft reward transfer to alice while deposit
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '511');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136');

    await agent.withdraw(zooPid, 0, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '622');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '40', "invalid 1 zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid 1 wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '272', "invalid 2 zoo amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid 2 wasp amount");
  });

  it("should success when withdraw amount with nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice}); // +20
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '400'); // 40 nft reward transfer to alice while deposit
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '511');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136');

    await agent.withdraw(zooPid, depositAmount, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '622');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '40', "invalid 1 zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid 1 wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '272', "invalid 2 zoo amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid 2 wasp amount");

    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '1000000', "invalid balance after withdraw");
  });

  it("should success when deposit amount no nft to nft PK", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeAliceWaspBalance = await waspToken.balanceOf(alice);
    let beforeBobWaspBalance = await waspToken.balanceOf(bob);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, 0, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');
    await agent.deposit(zooPid, 0, nftTokenID2, {from: alice}); // 400 transfer to alice
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount, 0, {from: bob});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '440');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '554');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '104');

    await agent.deposit(zooPid, 0, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '609'); // 40 + 10 + 10 nft reward transfer to alice while deposit
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '720');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136');


    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '460', "invalid 1 zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid 1 wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '209', "invalid 2 zoo amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid 2 wasp amount");
  });

  it("should success when withdraw amount with nft 3", async ()=>{
    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob});
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '250');
  });

  it("should success when dual withdraw amount with nft PK about multi-participator", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);

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
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    // console.log("nft", nftTokenID2, "owner:", (await nft.ownerOf(nftTokenID2)), "boosting:", (await nft.getBoosting(nftTokenID2)).toString(), "boost-address:", boosting.address);
    assert.strictEqual((await nft.ownerOf(nftTokenID2)).toLowerCase(), boosting.address.toLowerCase());

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    // console.log("alice pending zoo:", (await agent.pendingZoo(zooPid, alice)).toString());
    // console.log("bob pending zoo:", (await agent.pendingZoo(zooPid, bob)).toString());
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '400'); // nft reward (40) transfer to nft owner while nft updated
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    await time.advanceBlock();
    // console.log("alice pending zoo:", (await agent.pendingZoo(zooPid, alice)).toString());
    // console.log("bob pending zoo:", (await agent.pendingZoo(zooPid, bob)).toString());
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '511'); // 400 + 111
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '500'); // 400 + 100
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '100');
    await agent.withdraw(zooPid, depositAmount, {from: alice});
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '272');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '662', "invalid 1 zoo amount"); // 400 + 40 + 111 + 111

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '0', "invalid 2 zoo amount");

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '600', "invalid 1 wasp amount");

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid 2 wasp amount");
  });

  it("should success when cancel nft", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeZooBalance = await zooToken.balanceOf(alice);

    let waspToken = await WaspToken.at(await agent.wasp());
    let beforeWaspBalance = await waspToken.balanceOf(alice);

    let zooPid = await addZooKeeperSingleFarmPool(zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.removeNFT(zooPid, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '200');

    await agent.withdraw(zooPid, depositAmount, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');

    let afterZooBalance = await zooToken.balanceOf(alice);
    let deltaZooBalance = afterZooBalance.sub(beforeZooBalance)
    assert.strictEqual(deltaZooBalance.toString(10), '840', "invalid zoo amount");

    let afterWaspBalance = await waspToken.balanceOf(alice);
    let deltaWaspBalance = afterWaspBalance.sub(beforeWaspBalance)
    assert.strictEqual(deltaWaspBalance.toString(10), '0', "invalid wasp amount");
  });

  it("should success when cancel nft about multi-participator", async ()=>{
    let zooToken = await ZooToken.at(await agent.zoo());
    let beforeAliceZooBalance = await zooToken.balanceOf(alice);
    let beforeBobZooBalance = await zooToken.balanceOf(bob);

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
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');

    await agent.deposit(zooPid, depositAmount, nftTokenID3, {from: bob}); // +50
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '400'); // nft reward 40 has been transfered to alice
    let aliceZooBalance = await zooToken.balanceOf(alice);
    let aliceDeltaZooBalance = aliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(aliceDeltaZooBalance.toString(10), '40', "invalid nft reward");

    await time.advanceBlock();
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '511');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '136');

    await agent.removeNFT(zooPid, {from: bob});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '622');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    let bobZooBalance = await zooToken.balanceOf(bob);
    let bobDeltaZooBalance = bobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(bobDeltaZooBalance.toString(10), '272', "invalid remove nft amount");

    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '722');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '100');

    await agent.withdraw(zooPid, depositAmount, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '200');

    await agent.withdraw(zooPid, depositAmount, {from: bob});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '2');
    assert.strictEqual((await nft.balanceOf(bob)).toString(), '1');
    assert.strictEqual((await agent.pendingZoo(zooPid, bob)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, bob)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(bob)).toString(), '1000000');

    let afterAliceZooBalance = await zooToken.balanceOf(alice);
    let deltaAliceZooBalance = afterAliceZooBalance.sub(beforeAliceZooBalance)
    assert.strictEqual(deltaAliceZooBalance.toString(10), '862', "invalid 1 zoo amount"); // 40 + 400 + 111 + 111 + 100 + 100

    let afterAliceWaspBalance = await waspToken.balanceOf(alice);
    let deltaAliceWaspBalance = afterAliceWaspBalance.sub(beforeAliceWaspBalance)
    assert.strictEqual(deltaAliceWaspBalance.toString(10), '0', "invalid 1 wasp amount");

    let afterBobZooBalance = await zooToken.balanceOf(bob);
    let deltaBobZooBalance = afterBobZooBalance.sub(beforeBobZooBalance)
    assert.strictEqual(deltaBobZooBalance.toString(10), '672', "invalid 2 zoo amount"); // 136 + 136 + 100 + 100 + 200

    let afterBobWaspBalance = await waspToken.balanceOf(bob);
    let deltaBobWaspBalance = afterBobWaspBalance.sub(beforeBobWaspBalance)
    assert.strictEqual(deltaBobWaspBalance.toString(10), '0', "invalid 2 wasp amount");
  });

  it("should success when owner emergencyWithdraw", async ()=>{
    let zooPid = await addZooKeeperDualFarmPool(wanswapFarm, zooFarm, 100, lp1.address, withPoolUpdate);
    const depositAmount = 1000;
    assert.strictEqual((await lp1.balanceOf(alice)).toString(), '9000000');
    await agent.deposit(zooPid, depositAmount, nftTokenID2, {from: alice});
    assert.strictEqual((await nft.balanceOf(alice)).toString(), '1');
    await time.advanceBlock();
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');
    await zooFarm.emergencyWithdrawEnable(zooPid);
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '0');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');
    await agent.emergencyWithdrawEnable(zooPid);
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
    assert.strictEqual((await agent.pendingZoo(zooPid, alice)).toString(), '220');
    assert.strictEqual((await agent.pendingWasp(zooPid, alice)).toString(), '200');
    assert.strictEqual((await lp1.balanceOf(wanswapFarm.address)).toString(), depositAmount.toString());
    assert.strictEqual((await lp1.balanceOf(zooFarm.address)).toString(), '0');
    assert.strictEqual((await lp1.balanceOf(agent.address)).toString(), '0');

    try {
      await agent.emergencyWithdrawEnable(zooPid);
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
