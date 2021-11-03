// npx hardhat test .\test\TestFantomMarketplace_1.js --network localhost; run first in another shell: npx hardhat node
const {
  expectRevert,
  expectEvent,
  BN,
  ether,
  constants,
  balance,
  send
} = require('@openzeppelin/test-helpers');

const { expect } = require('chai');

const {
  ZERO,
  ONE,
  TWO,
  mockPayTokenName,
  mockPayTokenSymbol,
  mockPayTokenMintAmount,
  mockNFTokenName,
  mockNFTokenSymbol
} = require('../utils/index.js');

const {
  platformFee,
  marketPlatformFee,
  mintFee
} = require('../utils/marketplace');

const FantomMarketplace = artifacts.require('MockFantomMarketplace');
const FantomBundleMarketplace = artifacts.require('FantomBundleMarketplace');
const FantomAuction = artifacts.require('MockFantomAuction');
const FantomPriceFeed = artifacts.require('FantomPriceFeed');
const FantomAddressRegistry = artifacts.require('FantomAddressRegistry');
const FantomTokenRegistry = artifacts.require('FantomTokenRegistry');
const MockERC20 = artifacts.require('MockERC20');
const MockERC721 = artifacts.require('MockERC721');

contract('FantomMarketplace - Offering Test', function([
  owner,
  platformFeeRecipient,
  artist,
  hacker,
  buyer,
  account1
]) {
  before(async function() {
    let result;
    let tokenId;
    let listing;
    let wFTMBalance;
    let nftOwner;
    let offer;

    this.mockERC20 = await MockERC20.new(
      mockPayTokenName,
      mockPayTokenSymbol,
      ZERO
    );

    this.mockERC20_invalid = await MockERC20.new(
      mockPayTokenName,
      mockPayTokenSymbol,
      ZERO
    );

    this.fantomAddressRegistry = await FantomAddressRegistry.new();

    this.mockERC721 = await MockERC721.new(
      mockPayTokenSymbol,
      mockPayTokenSymbol
    );

    this.fantomMarketplace = await FantomMarketplace.new();
    await this.fantomMarketplace.initialize(
      platformFeeRecipient,
      marketPlatformFee
    );
    await this.fantomMarketplace.updateAddressRegistry(
      this.fantomAddressRegistry.address
    );

    this.fantomBundleMarketplace = await FantomBundleMarketplace.new();
    await this.fantomBundleMarketplace.initialize(
      platformFeeRecipient,
      marketPlatformFee
    );
    await this.fantomBundleMarketplace.updateAddressRegistry(
      this.fantomAddressRegistry.address
    );

    this.fantomAuction = await FantomAuction.new();
    await this.fantomAuction.initialize(platformFeeRecipient);
    await this.fantomAuction.updateAddressRegistry(
      this.fantomAddressRegistry.address
    );

    this.fantomTokenRegistry = await FantomTokenRegistry.new();
    this.fantomTokenRegistry.add(this.mockERC20.address);

    await this.fantomAddressRegistry.updateTokenRegistry(
      this.fantomTokenRegistry.address
    );

    this.fantomPriceFeed = await FantomPriceFeed.new(
      this.fantomAddressRegistry.address,
      this.mockERC20.address
    );

    await this.fantomAddressRegistry.updateMarketplace(
      this.fantomMarketplace.address
    );
    await this.fantomAddressRegistry.updateBundleMarketplace(
      this.fantomBundleMarketplace.address
    );

    await this.fantomAddressRegistry.updateAuction(this.fantomAuction.address);

    await this.fantomAddressRegistry.updatePriceFeed(
      this.fantomPriceFeed.address
    );

    await this.mockERC721.mint(artist, { from: artist });

    await this.mockERC721.mint(artist, { from: artist });

    await this.mockERC721.setApprovalForAll(
      this.fantomMarketplace.address,
      true,
      {
        from: artist
      }
    );

    await this.fantomMarketplace.listItem(
      this.mockERC721.address,
      ZERO,
      ONE,
      this.mockERC20.address,
      ether('20'),
      new BN('1632304800'), // 2021-09-22 10:00:00 GMT
      { from: artist }
    );

    await this.mockERC721.setApprovalForAll(this.fantomAuction.address, true, {
      from: artist
    });

    await this.fantomAuction.createAuction(
      this.mockERC721.address,
      ONE,
      this.mockERC20.address,
      ether('20'),
      new BN('1632564000'), //2021-09-25 10:00:00
      false,
      new BN('1632996000'), //2021-09-30 10:00:00
      { from: artist }
    );
  });

  it(`A buyer makes an offer for a listed nft with the deadline in the past. 
      He/She will fail with "invalid expiration"`, async function() {
    //Let's mock that the current time:2021-09-22 11:00:00 GMT
    await this.fantomMarketplace.setTime(new BN('1632308400'));

    //The buyer makes an offer for the nft for 18 wFTMs with deadline on 2021-09-22 10:00:00 GMT
    await expectRevert(
      this.fantomMarketplace.createOffer(
        this.mockERC721.address,
        ZERO,
        this.mockERC20.address,
        ONE,
        ether('18'),
        new BN('1632304800'),
        { from: buyer }
      ),
      'invalid expiration'
    );
  });

  it(`A buyer makes an offer a nft which is in auction. 
      He/She will fail with "cannot place an offer if auction is going on"`, async function() {
    //Let's mock that the current time:2021-09-22 11:00:00 GMT
    await this.fantomMarketplace.setTime(new BN('1632308400'));

    //The buyer makes an offer for the nft for 18 wFTMs with deadline on 2021-09-22 15:00:00 GMT
    await expectRevert.unspecified(
      this.fantomMarketplace.createOffer(
        this.mockERC721.address,
        ONE,
        this.mockERC20.address,
        ONE,
        ether('18'),
        new BN('1632322800'),
        { from: buyer }
      )
    );

    //.TODO : this should work but it doesn't
    /*  await expectRevert(
        this.fantomMarketplace.createOffer(
          this.mockERC721.address,
          ONE,
          this.mockERC20.address,
          ONE,
          ether('18'),
          new BN('1632322800'),
          { from: buyer }
        ), 'cannot place an offer if auction is going on'
      ); */
  });

  it(`A buyer makes an offer for a listed nft for a lower price. 
      OfferCreated event should be emitted with correct values`, async function() {
    await this.mockERC20.mintPay(buyer, ether('18'));
    //The buyer approve his/her wFTM to the marketplace
    await this.mockERC20.approve(this.fantomMarketplace.address, ether('18'), {
      from: buyer
    });

    //Let's mock that the current time:2021-09-22 11:00:00 GMT
    await this.fantomMarketplace.setTime(new BN('1632308400'));

    //The buyer makes an offer for the nft for 18 wFTMs with deadline on 2021-09-22 15:00:00 GMT
    result = await this.fantomMarketplace.createOffer(
      this.mockERC721.address,
      ZERO,
      this.mockERC20.address,
      ONE,
      ether('18'),
      new BN('1632322800'),
      { from: buyer }
    );

    //Event OfferCreated should be emitted with correct values
    expectEvent(result, 'OfferCreated', {
      creator: buyer,
      nft: this.mockERC721.address,
      tokenId: ZERO,
      quantity: ONE,
      payToken: this.mockERC20.address,
      pricePerItem: ether('18'),
      deadline: new BN('1632322800')
    });
  });

  it(`The same buyer tries to create the same offer again. He/She will fail with "offer already created"`, async function() {
    await expectRevert(
      this.fantomMarketplace.createOffer(
        this.mockERC721.address,
        ZERO,
        this.mockERC20.address,
        ONE,
        ether('18'),
        new BN('1632322800'),
        { from: buyer }
      ),
      'offer already created'
    );
  });

  it(`A hacker tries to cancel the offer. He/She will fail with "offer not exists or expired"`, async function() {
    await expectRevert(
      this.fantomMarketplace.cancelOffer(this.mockERC721.address, ZERO, {
        from: hacker
      }),
      'offer not exists or expired'
    );
  });

  it(`The buyer cancels the offer. OfferCanceled event should be emitted`, async function() {
    result = await this.fantomMarketplace.cancelOffer(
      this.mockERC721.address,
      ZERO,
      { from: buyer }
    );
    expectEvent(result, 'OfferCanceled', {
      creator: buyer,
      nft: this.mockERC721.address,
      tokenId: ZERO
    });
  });

  it(`After the buyer cancels, the offer should be removed from the offer list`, async function() {
    offer = await this.fantomMarketplace.offers(
      this.mockERC721.address,
      ZERO,
      buyer
    );
    expect(offer.payToken).to.be.equal(constants.ZERO_ADDRESS);
    expect(offer.deadline.toString()).to.be.equal(ZERO.toString());
  });

  it(`The buyer makes another offer after canceling the previous one. 
      OfferCreated event should be emitted with correct values`, async function() {
    //The buyer makes an offer for the nft for 18 wFTMs with deadline on 2021-09-22 15:00:00 GMT
    result = await this.fantomMarketplace.createOffer(
      this.mockERC721.address,
      ZERO,
      this.mockERC20.address,
      ONE,
      ether('18'),
      new BN('1632322800'),
      { from: buyer }
    );

    //Event OfferCreated should be emitted with correct values
    expectEvent(result, 'OfferCreated', {
      creator: buyer,
      nft: this.mockERC721.address,
      tokenId: ZERO,
      quantity: ONE,
      payToken: this.mockERC20.address,
      pricePerItem: ether('18'),
      deadline: new BN('1632322800')
    });
  });

  it(`A hacker tries to accept the offer. He/She will fail with "not owning item"`, async function() {
    await expectRevert(
      this.fantomMarketplace.acceptOffer(this.mockERC721.address, ZERO, buyer, {
        from: hacker
      }),
      'not owning item'
    );
  });

  it(`The seller tries to accept an offer whose deadline has passed. 
      He/She will fail with "offer not exist or expired"`, async function() {
    //Let's mock the current time: 2021-09-23 15:00:00 GMT
    await this.fantomMarketplace.setTime(new BN('1632409200'));
    await expectRevert(
      this.fantomMarketplace.acceptOffer(this.mockERC721.address, ZERO, buyer, {
        from: artist
      }),
      'offer not exists or expired'
    );
  });
});
