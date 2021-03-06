'use strict';

const cheerio = require('cheerio');
const cloudscraper = require('cloudscraper');
const CryptoJS = require("crypto-js");
const querystring = require('querystring');
const request = require('request');

const P_A_C_K_E_R = require('./lib/p_a_c_k_e_r_unpacker.js');
const IMG2JS = require('./lib/img2js_unpacker.js');

const defaultOptions = {
  baseUrl: 'https://extra.to',
  timeout: 4 * 1000
};
/*
https://extra.to
https://etmirror.com
https://etproxy.com
https://extratorrentonline.com
https://extratorrentlive.com
https://extratorrent.works
https://extratorrent.life
https://extratorrent.one
*/

// taken from http://extratorrent.cc/scripts/main.js
const CryptoJSAesJson = {

  stringify(a) {
    const j = {
      ct: a.ciphertext.toString(CryptoJS.enc.Base64)
    };
    if (a.iv) j.iv = a.iv.toString();
    if (a.salt) j.s = a.salt.toString();

    return JSON.stringify(j);
  },

  parse(a) {
    const j = JSON.parse(a);
    const b = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(j.ct)
    });

    if (j.iv) b.iv = CryptoJS.enc.Hex.parse(j.iv);
    if (j.s) b.salt = CryptoJS.enc.Hex.parse(j.s);

    return b;
  }

};

module.exports = class ExtraTorrentAPI {

  constructor({options = defaultOptions, debug = false, cloudflare = true} = {}) {
    ExtraTorrentAPI._options = options;

    if (cloudflare) {
      this._cloudflare = true;
      this._request = cloudscraper.request;
      this._options = options;
      if (debug) {
        console.warn('Processing with cloudscraper...');
      }
    } else {
      this._request = request.defaults(options);
    }
    this._debug = debug;

    this._s_cat = {
      'anime': '1',
      'books': '2',
      'games': '3',
      'movies': '4',
      'music': '5',
      'pictures': '6',
      'software': '7',
      'tv': '8',
      'other': '9',
      'mobile': '416',
      'adult': '533'
    };

    this._added = {
      '1': 1,
      '3': 3,
      '7': 7
    };

    this._size_types = {
      'b': 'b',
      'kb': 'kb',
      'mb': 'mb',
      'gb': 'gb'
    };
  }

  _get(uri, qs, retry = true) {
    if (this._debug) console.warn(`Making request to: '${uri}'`);
    return new Promise((resolve, reject) => {
      let options;
      if (this._cloudflare) {
        options = Object.assign({}, this._options, {method: 'GET', url: this._options.baseUrl + uri, qs});
        options.baseUrl = null;
      } else {
        options = { uri, qs };
      }
      this._request(options, (err, res, body) => {
        if (err && retry) {
          return resolve(this._get(uri, qs, false));
        } else if (err) {
          return reject(err);
        } else if (!body || res.statusCode >= 400) {
          return reject(new Error(`No data found with url: '${uri}', statusCode: ${res.statusCode}`));
        } else {
          // console.log(body);
          return resolve(body);
        }
      });
    });
  }

  _formatPage(res, page, date) {
    let $ = cheerio.load(res);

    let e_content = $('div#e_content');
    if(e_content.length > 0) {
      const hashObject = e_content.text();
      const salt = JSON.parse(hashObject).s;

      let temp = $('div#e_content + script').eq(0).text();
      if(P_A_C_K_E_R.detect(temp)) temp = P_A_C_K_E_R.unpack(temp);
      if(IMG2JS.detect(temp)) temp = IMG2JS.unpack(temp);

      try {
        let plainKey = temp.replace(/\s/g,'').split(".html(),'");

        if(plainKey.length > 1) {
            var key = plainKey[1].split("'")[0];
        }
        else {
            if (this._debug) console.warn(`Unable to detect key elements...`);
        }
      } catch(e) {
          if (this._debug) console.warn(`Unable to extract the encryption key...`, e);
      }

      if(!key) return {
        response_time: 0,
        page: 0,
        total_results: 0,
        total_pages: 0,
        results: []
      };

      var data = JSON.parse(CryptoJS.AES.decrypt(hashObject, key, {
        format: CryptoJSAesJson
      }).toString(CryptoJS.enc.Utf8));

      $ = cheerio.load(data);
    }
    else {
      var data = res;
    }
    
    const total_results = parseInt(data.match(/total\s\<b\>(\d+)\<\/b\>\storrents\sfound/i)[1]);
    let total_pages = Math.ceil(total_results / 50);
    if (total_pages > 200) total_pages = 200;

    const result = {
      response_time: parseInt(date, 10),
      page: parseInt(page, 10),
      total_results,
      total_pages: parseInt(total_pages, 10),
      results: []
    };

    $('tr.tlr, tr.tlz').each(function() {
      const entry = $(this).find('td');

      let language, title, sub_category

      const url = ExtraTorrentAPI._options.baseUrl + entry.eq(2).find('a').attr('href');
      const torrent_link = ExtraTorrentAPI._options.baseUrl + entry.eq(0).find('a').eq(0).attr('href');
      const magnet = entry.eq(0).find('a').eq(1).attr('href');
      const date_added = entry.eq(3).text();
      const size = entry.eq(4).text();
      const seeds = ($(this).find('td.sy').text() == '') ? 0 : parseInt($(this).find('td.sy').text(), 10);
      const leechers = ($(this).find('td.ly').text() == '') ? 0 : parseInt($(this).find('td.ly').text(), 10);
      const peers = seeds + leechers;
      const quality = parseInt(entry.last().find('div').attr('class').replace(/r/i, ''), 10);

      let comments = $(this).find('td.tli').find('div#tcmm');
      if (comments.length !== 0) {
        language = entry.eq(2).find('img.icon').eq(1).attr('alt');
        title = entry.eq(2).find('a').eq(1).text();
        sub_category = entry.eq(2).find('a').eq(2).text();
        comments = parseInt(entry.eq(2).find('a').eq(0).text(), 10);
      } else {
        language = entry.eq(2).find('img.icon').eq(0).attr('alt');
        title = entry.eq(2).find('a').eq(0).text();
        sub_category = entry.eq(2).find('a').eq(0).text();
        comments = comments.length;
      };

      result.results.push({ url, torrent_link, magnet, language, title, sub_category, comments, date_added, size, seeds, leechers, peers, quality });
    });

    return result;
  }

  _advancedSearch({page, with_words, extact, without, category, added, seeds_from, seeds_to, leechers_from, leechers_to, size_from, size_to, size_type} = {}, date) {
    if (!with_words) throw new Error(`'with_words' is a required field`);
    if (added && !this._added[added]) throw new Error(`'${added}' is not a valid value for added!`);
    if (size_type && !this._size_types[size_type]) throw new Error(`'${size_type}' is not a valid value for value size_type!`);

    if (category && !this._s_cat[category]) {
      throw new Error(`${category} is not a valid value for category!`);
    } else if (category && this._s_cat[category]) {
      category = this._s_cat[category];
    }

    return this._get('/advanced_search/', {
      page,
      'with': with_words,
      extact,
      without,
      s_cat: category,
      added,
      seeds_from,
      seeds_to,
      leechers_from,
      leechers_to,
      size_from,
      size_type,
      size_to
    }).then(res => this._formatPage(res, page, Date.now() - date));
  }

  _simpleSearch(query, date) {
    return this._get('/search/', {search: query}).then(res => this._formatPage(res, 1, Date.now() - date));
  }

  search(query) {
    const t = Date.now();
    if (typeof(query) === 'string') {
      return this._simpleSearch(query, t);
    } else if (typeof(query) === 'object') {
      return this._advancedSearch(query, t)
    } else {
      throw new Error(`Query needs to be an object or a string!`);
    }
  }

}
