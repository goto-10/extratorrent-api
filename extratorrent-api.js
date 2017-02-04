'use strict';

const cheerio = require('cheerio');
const cloudscraper = require('cloudscraper');
const CryptoJS = require("crypto-js");
const querystring = require('querystring');
const request = require('request');

const defaultOptions = {
  baseUrl: 'https://extratorrent.cc',
  timeout: 4 * 1000
};

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

    const hashObject = $('div#e_content').text();
    const salt = JSON.parse(hashObject).s;

    let temp = $('div#e_content + script').eq(0).text().split('function et(){')[1];
    temp = this._parseImg2js(temp);

    const newsNr = temp.split("z+'s li a')[")[1].split(']')[0];
    temp = temp.split('.decrypt(dd, f.s[')[1].split('{format:')[0];
    const saltChar1 = temp.split(']')[0];
    const saltDigits = temp.split("'")[1].split("'")[0];
    const saltChar2 = temp.split('+f.s[')[1].split(']')[0];

    const newsId = $('.ten_articles li a').eq(newsNr).attr('href').split('le/')[1].split('/')[0];
    const key = salt[saltChar1] + saltDigits + '0' + newsId + salt[saltChar2];

    const data = JSON.parse(CryptoJS.AES.decrypt(hashObject, key, {
      format: CryptoJSAesJson
    }).toString(CryptoJS.enc.Utf8));

    $ = cheerio.load(data);

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
  
    _parseImg2js(inputVal)
    {
        try {
            var pngB64 = 'iVBORw0KGgoAAAANSUhEU'+inputVal.split("'iVBORw0KGgoAAAANSUhEU")[1].split("'")[0];
            var shiftVal = inputVal.split('=[0,255,')[1].split('];')[0];
        } catch(e) {
            console.warn('Invalid input for _parseImg2js!');
            return;
        }

        return this._img2js(pngB64, shiftVal);
    }

    _img2js(pngB64, shiftVal) {
        console.log(pngB64.length, shiftVal);
        if(!pngB64 || isNaN(shiftVal)) {
            console.warn('Invalid input for _img2js!');
            return '';
        }
        
        var resultStr = '';

        var imgObj = new window.Image();
        imgObj.style.display = 'none';
        imgObj.src = 'data:image/png;base64,'+pngB64;

        var canvasEl = window.document.createElement('canvas');
        canvasEl.width = imgObj.width;
        canvasEl.height = imgObj.height;
        canvasEl.style.display = 'none';

        var canvasCtx = canvasEl.getContext('2d');
        canvasCtx.drawImage(imgObj, 0, 0);

        var imgData = canvasCtx.getImageData(0, 0, canvasEl.width, canvasEl.height);

        for(var i=parseInt(shiftVal); i < imgData.data.length; i+=4) {
            resultStr += (imgData.data[i] != 255) ? String.fromCharCode(imgData.data[i]) : ''; 
        }
        resultStr=resultStr.trim();

        //console.log(window.atob(resultStr));
        return unescape(decodeURIComponent(window.atob(resultStr)));
    }

}
