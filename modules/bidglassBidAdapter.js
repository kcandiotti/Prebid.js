import {_each, isArray, deepClone, getUniqueIdentifierStr, getBidIdParameter} from '../src/utils.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 * @typedef {import('../src/adapters/bidderFactory.js').BidderRequest} BidderRequest
 * @typedef {import('../src/adapters/bidderFactory.js').ServerRequest} ServerRequest
 * @typedef {import('../src/adapters/bidderFactory.js').ServerResponse} ServerResponse
 */

const BIDDER_CODE = 'bidglass';

export const spec = {
  code: BIDDER_CODE,
  aliases: ['bg'], // short code
  /**
   * Determines whether or not the given bid request is valid.
   *
   * @param {BidRequest} bid The bid params to validate.
   * @return boolean True if this is a valid bid, and false otherwise.
   */
  isBidRequestValid: function(bid) {
    return !!bid.params.adUnitId; // only adUnitId is required
  },
  /**
   * Make a server request from the list of BidRequests.
   *
   * @param {BidRequest[]} validBidRequests an array of bids
   * @param {BidderRequest} bidderRequest request by bidder
   * @return {ServerRequest} Info describing the request to the server.
   */
  buildRequests: function(validBidRequests, bidderRequest) {
    /*
    Sample array entry for validBidRequests[]:
    [{
      "bidder": "bidglass",
      "bidId": "51ef8751f9aead",
      "params": {
      "adUnitId": 11,
      ...
      },
      "adUnitCode": "div-gpt-ad-1460505748561-0",
      "transactionId": "d7b773de-ceaa-484d-89ca-d9f51b8d61ec",
      "sizes": [[320,50],[300,250],[300,600]],
      "bidderRequestId": "418b37f85e772c",
      "auctionId": "18fd8b8b0bd757",
      "bidRequestsCount": 1
    }]
    */

    const imps = [];
    const getReferer = function() {
      return window === window.top ? window.location.href : window.parent === window.top ? document.referrer : null;
    };
    const getOrigins = function() {
      var ori = [window.location.protocol + '//' + window.location.hostname];

      if (window.location.ancestorOrigins) {
        for (var i = 0; i < window.location.ancestorOrigins.length; i++) {
          ori.push(window.location.ancestorOrigins[i]);
        }
      } else if (window !== window.top) {
        // Derive the parent origin
        var parts = document.referrer.split('/');

        ori.push(parts[0] + '//' + parts[2]);

        if (window.parent !== window.top) {
          // Additional unknown origins exist
          ori.push('null');
        }
      }

      return ori;
    };

    const bidglass = window['bidglass'];

    _each(validBidRequests, function(bid) {
      bid.sizes = ((isArray(bid.sizes) && isArray(bid.sizes[0])) ? bid.sizes : [bid.sizes]);
      bid.sizes = bid.sizes.filter(size => isArray(size));

      var adUnitId = getBidIdParameter('adUnitId', bid.params);
      var options = deepClone(bid.params);

      delete options.adUnitId;

      // Merge externally set targeting params
      if (typeof bidglass === 'object' && bidglass.getTargeting) {
        const targeting = bidglass.getTargeting(adUnitId, options.targeting);

        if (targeting && Object.keys(targeting).length > 0) options.targeting = targeting;
      }

      // Stuff to send: [bid id, sizes, adUnitId, options]
      imps.push({
        bidId: bid.bidId,
        sizes: bid.sizes,
        adUnitId: adUnitId,
        options: options
      });
    });

    // Consent data
    const gdprConsentObj = bidderRequest && bidderRequest.gdprConsent;
    const gppConsentObj = bidderRequest && bidderRequest.gppConsent;
    const gppApplicableSections = gppConsentObj && gppConsentObj.applicableSections;
    const ortb2Regs = bidderRequest && bidderRequest.ortb2 && bidderRequest.ortb2.regs;
    const ortb2Gpp = ortb2Regs && ortb2Regs.gpp;

    // Build bid request data to be sent to ad server
    const bidReq = {
      reqId: getUniqueIdentifierStr(),
      imps: imps,
      ref: getReferer(),
      ori: getOrigins(),

      // GDPR applies? numeric boolean
      gdprApplies: (gdprConsentObj && gdprConsentObj.gdprApplies) ? 1 : '',
      // IAB TCF consent string
      gdprConsent: (gdprConsentObj && gdprConsentObj.consentString) || '',

      // IAB GPP consent string
      gppString: (gppConsentObj && gppConsentObj.gppString) || ortb2Gpp || '',
      // GPP Applicable Section IDs
      gppSid: (isArray(gppApplicableSections) && gppApplicableSections.length)
        ? gppApplicableSections.join(',')
        : ((ortb2Gpp && ortb2Regs.gpp_sid) || '')
    };

    const url = 'https://bid.glass/ad/hb.php?' +
      `src=$$REPO_AND_VERSION$$`;

    return {
      method: 'POST',
      url: url,
      data: JSON.stringify(bidReq),
      options: {
        contentType: 'text/plain',
        withCredentials: false
      }
    }
  },

  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {ServerResponse} serverResponse A successful response from the server.
   * @param {ServerRequest} serverRequest The original server request for this bid
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function(serverResponse, serverRequest) {
    const bidResponses = [];
    const bidReq = JSON.parse(serverRequest.data);

    _each(serverResponse.body.bidResponses, function(serverBid) {
      const bidResponse = {
        requestId: serverBid.requestId,
        cpm: parseFloat(serverBid.cpm),
        width: parseInt(serverBid.width, 10),
        height: parseInt(serverBid.height, 10),
        creativeId: serverBid.creativeId,
        dealId: serverBid.dealId || null,
        currency: serverBid.currency || 'USD',
        mediaType: serverBid.mediaType || 'banner',
        netRevenue: true,
        ttl: serverBid.ttl || 10,
        // Replace the &replaceme placeholder in the returned <script> URL with
        // URL-encoded GDPR/GPP params from the bid request. If no relevant values
        // are present, &replaceme is removed entirely.
        ad: serverBid.ad.replace(
          '&replaceme',
          () => {
            const urlEncodedExtras = ['gdprApplies', 'gdprConsent', 'gppString', 'gppSid']
              .filter(key => bidReq[key] != null)
              .map(key => `${key}=${encodeURIComponent(bidReq[key])}`)
              .join('&');
            return urlEncodedExtras ? ('&' + urlEncodedExtras) : '';
          }
        ),
        meta: {}
      };

      if (serverBid.meta) {
        const meta = serverBid.meta;

        if (meta.advertiserDomains && meta.advertiserDomains.length) {
          bidResponse.meta.advertiserDomains = meta.advertiserDomains;
        }
      }

      bidResponses.push(bidResponse);
    });

    return bidResponses;
  }

}

registerBidder(spec);
