/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Bookmarks Sync.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Dan Mills <thunder@mozilla.com>
 *  Richard Newman <rnewman@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ["XPCOMUtils", "Services", "NetUtil", "PlacesUtils",
                          "FileUtils", "Utils", "Async", "Svc", "Str"];

const {classes: Cc, interfaces: Ci, results: Cr, utils: Cu} = Components;

Cu.import("resource://services-common/log4moz.js");
Cu.import("resource://services-common/preferences.js");
Cu.import("resource://services-common/stringbundle.js");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-common/async.js");
Cu.import("resource://services-sync/constants.js");
Cu.import("resource://services-common/observers.js");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PlacesUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

/*
 * Utility functions
 */

let Utils = {
  // Alias in functions from CommonUtils. These previously were defined here.
  // In the ideal world, references to these would be removed.
  nextTick: CommonUtils.nextTick,
  namedTimer: CommonUtils.namedTimer,
  exceptionStr: CommonUtils.exceptionStr,
  stackTrace: CommonUtils.stackTrace,
  makeURI: CommonUtils.makeURI,
  encodeUTF8: CommonUtils.encodeUTF8,
  decodeUTF8: CommonUtils.decodeUTF8,
  safeAtoB: CommonUtils.safeAtoB,

  /**
   * Wrap a function to catch all exceptions and log them
   *
   * @usage MyObj._catch = Utils.catch;
   *        MyObj.foo = function() { this._catch(func)(); }
   *        
   * Optionally pass a function which will be called if an
   * exception occurs.
   */
  catch: function Utils_catch(func, exceptionCallback) {
    let thisArg = this;
    return function WrappedCatch() {
      try {
        return func.call(thisArg);
      }
      catch(ex) {
        thisArg._log.debug("Exception: " + Utils.exceptionStr(ex));
        if (exceptionCallback) {
          return exceptionCallback.call(thisArg, ex);
        }
        return null;
      }
    };
  },

  /**
   * Wrap a function to call lock before calling the function then unlock.
   *
   * @usage MyObj._lock = Utils.lock;
   *        MyObj.foo = function() { this._lock(func)(); }
   */
  lock: function lock(label, func) {
    let thisArg = this;
    return function WrappedLock() {
      if (!thisArg.lock()) {
        throw "Could not acquire lock. Label: \"" + label + "\".";
      }

      try {
        return func.call(thisArg);
      }
      finally {
        thisArg.unlock();
      }
    };
  },
  
  isLockException: function isLockException(ex) {
    return ex && ex.indexOf && ex.indexOf("Could not acquire lock.") == 0;
  },

  /**
   * Wrap functions to notify when it starts and finishes executing or if it
   * threw an error.
   * 
   * The message is a combination of a provided prefix, the local name, and
   * the event. Possible events are: "start", "finish", "error". The subject
   * is the function's return value on "finish" or the caught exception on
   * "error". The data argument is the predefined data value.
   * 
   * Example:
   * 
   * @usage function MyObj(name) {
   *          this.name = name;
   *          this._notify = Utils.notify("obj:");
   *        }
   *        MyObj.prototype = {
   *          foo: function() this._notify("func", "data-arg", function () {
   *            //...
   *          }(),
   *        };
   */
  notify: function Utils_notify(prefix) {
    return function NotifyMaker(name, data, func) {
      let thisArg = this;
      let notify = function(state, subject) {
        let mesg = prefix + name + ":" + state;
        thisArg._log.trace("Event: " + mesg);
        Observers.notify(mesg, subject, data);
      };

      return function WrappedNotify() {
        try {
          notify("start", null);
          let ret = func.call(thisArg);
          notify("finish", ret);
          return ret;
        }
        catch(ex) {
          notify("error", ex);
          throw ex;
        }
      };
    };
  },

  runInTransaction: function(db, callback, thisObj) {
    let hasTransaction = false;
    try {
      db.beginTransaction();
      hasTransaction = true;
    } catch(e) { /* om nom nom exceptions */ }

    try {
      return callback.call(thisObj);
    } finally {
      if (hasTransaction) {
        db.commitTransaction();
      }
    }
  },

  byteArrayToString: function byteArrayToString(bytes) {
    return [String.fromCharCode(byte) for each (byte in bytes)].join("");
  },

  /**
   * Generate a string of random bytes.
   */
  generateRandomBytes: function generateRandomBytes(length) {
    let rng = Cc["@mozilla.org/security/random-generator;1"]
                .createInstance(Ci.nsIRandomGenerator);
    let bytes = rng.generateRandomBytes(length);
    return Utils.byteArrayToString(bytes);
  },

  /**
   * Encode byte string as base64url (RFC 4648).
   */
  encodeBase64url: function encodeBase64url(bytes) {
    return btoa(bytes).replace('+', '-', 'g').replace('/', '_', 'g');
  },

  /**
   * GUIDs are 9 random bytes encoded with base64url (RFC 4648).
   * That makes them 12 characters long with 72 bits of entropy.
   */
  makeGUID: function makeGUID() {
    return Utils.encodeBase64url(Utils.generateRandomBytes(9));
  },

  _base64url_regex: /^[-abcdefghijklmnopqrstuvwxyz0123456789_]{12}$/i,
  checkGUID: function checkGUID(guid) {
    return !!guid && this._base64url_regex.test(guid);
  },

  /**
   * Add a simple getter/setter to an object that defers access of a property
   * to an inner property.
   *
   * @param obj
   *        Object to add properties to defer in its prototype
   * @param defer
   *        Property of obj to defer to
   * @param prop
   *        Property name to defer (or an array of property names)
   */
  deferGetSet: function Utils_deferGetSet(obj, defer, prop) {
    if (Array.isArray(prop))
      return prop.map(function(prop) Utils.deferGetSet(obj, defer, prop));

    let prot = obj.prototype;

    // Create a getter if it doesn't exist yet
    if (!prot.__lookupGetter__(prop)) {
      prot.__defineGetter__(prop, function () {
        return this[defer][prop];
      });
    }

    // Create a setter if it doesn't exist yet
    if (!prot.__lookupSetter__(prop)) {
      prot.__defineSetter__(prop, function (val) {
        this[defer][prop] = val;
      });
    }
  },

  lazyStrings: function Weave_lazyStrings(name) {
    let bundle = "chrome://weave/locale/services/" + name + ".properties";
    return function() new StringBundle(bundle);
  },

  deepEquals: function eq(a, b) {
    // If they're triple equals, then it must be equals!
    if (a === b)
      return true;

    // If they weren't equal, they must be objects to be different
    if (typeof a != "object" || typeof b != "object")
      return false;

    // But null objects won't have properties to compare
    if (a === null || b === null)
      return false;

    // Make sure all of a's keys have a matching value in b
    for (let k in a)
      if (!eq(a[k], b[k]))
        return false;

    // Do the same for b's keys but skip those that we already checked
    for (let k in b)
      if (!(k in a) && !eq(a[k], b[k]))
        return false;

    return true;
  },

  // Generator and discriminator for HMAC exceptions.
  // Split these out in case we want to make them richer in future, and to
  // avoid inevitable confusion if the message changes.
  throwHMACMismatch: function throwHMACMismatch(shouldBe, is) {
    throw "Record SHA256 HMAC mismatch: should be " + shouldBe + ", is " + is;
  },

  isHMACMismatch: function isHMACMismatch(ex) {
    const hmacFail = "Record SHA256 HMAC mismatch: ";
    return ex && ex.indexOf && (ex.indexOf(hmacFail) == 0);
  },

  /**
   * UTF8-encode a message and hash it with the given hasher. Returns a
   * string containing bytes. The hasher is reset if it's an HMAC hasher.
   */
  digestUTF8: function digestUTF8(message, hasher) {
    let data = this._utf8Converter.convertToByteArray(message, {});
    hasher.update(data, data.length);
    let result = hasher.finish(false);
    if (hasher instanceof Ci.nsICryptoHMAC) {
      hasher.reset();
    }
    return result;
  },

  /**
   * Treat the given message as a bytes string and hash it with the given
   * hasher. Returns a string containing bytes. The hasher is reset if it's
   * an HMAC hasher.
   */
  digestBytes: function digestBytes(message, hasher) {
    // No UTF-8 encoding for you, sunshine.
    let bytes = [b.charCodeAt() for each (b in message)];
    hasher.update(bytes, bytes.length);
    let result = hasher.finish(false);
    if (hasher instanceof Ci.nsICryptoHMAC) {
      hasher.reset();
    }
    return result;
  },

  bytesAsHex: function bytesAsHex(bytes) {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += ("0" + bytes[i].charCodeAt().toString(16)).slice(-2);
    }
    return hex;
  },

  _sha1: function _sha1(message) {
    let hasher = Cc["@mozilla.org/security/hash;1"].
      createInstance(Ci.nsICryptoHash);
    hasher.init(hasher.SHA1);
    return Utils.digestUTF8(message, hasher);
  },

  sha1: function sha1(message) {
    return Utils.bytesAsHex(Utils._sha1(message));
  },

  sha1Base32: function sha1Base32(message) {
    return Utils.encodeBase32(Utils._sha1(message));
  },
  
  /**
   * Produce an HMAC key object from a key string.
   */
  makeHMACKey: function makeHMACKey(str) {
    return Svc.KeyFactory.keyFromString(Ci.nsIKeyObject.HMAC, str);
  },
    
  /**
   * Produce an HMAC hasher and initialize it with the given HMAC key.
   */
  makeHMACHasher: function makeHMACHasher(type, key) {
    let hasher = Cc["@mozilla.org/security/hmac;1"]
                   .createInstance(Ci.nsICryptoHMAC);
    hasher.init(type, key);
    return hasher;
  },

  /**
   * HMAC-based Key Derivation Step 2 according to RFC 5869.
   */
  hkdfExpand: function hkdfExpand(prk, info, len) {
    const BLOCKSIZE = 256 / 8;
    let h = Utils.makeHMACHasher(Ci.nsICryptoHMAC.SHA256,
                                 Utils.makeHMACKey(prk));
    let T = "";
    let Tn = "";
    let iterations = Math.ceil(len/BLOCKSIZE);
    for (let i = 0; i < iterations; i++) {
      Tn = Utils.digestBytes(Tn + info + String.fromCharCode(i + 1), h);
      T += Tn;
    }
    return T.slice(0, len);
  },

  /**
   * PBKDF2 implementation in Javascript.
   * 
   * The arguments to this function correspond to items in 
   * PKCS #5, v2.0 pp. 9-10 
   * 
   * P: the passphrase, an octet string:              e.g., "secret phrase"
   * S: the salt, an octet string:                    e.g., "DNXPzPpiwn"
   * c: the number of iterations, a positive integer: e.g., 4096
   * dkLen: the length in octets of the destination 
   *        key, a positive integer:                  e.g., 16
   *        
   * The output is an octet string of length dkLen, which you
   * can encode as you wish.
   */
  pbkdf2Generate : function pbkdf2Generate(P, S, c, dkLen) {
    // We don't have a default in the algo itself, as NSS does.
    // Use the constant.
    if (!dkLen)
      dkLen = SYNC_KEY_DECODED_LENGTH;
    
    /* For HMAC-SHA-1 */
    const HLEN = 20;
    
    function F(S, c, i, h) {
    
      function XOR(a, b, isA) {
        if (a.length != b.length) {
          return false;
        }

        let val = [];
        for (let i = 0; i < a.length; i++) {
          if (isA) {
            val[i] = a[i] ^ b[i];
          } else {
            val[i] = a.charCodeAt(i) ^ b.charCodeAt(i);
          }
        }

        return val;
      }
    
      let ret;
      let U = [];

      /* Encode i into 4 octets: _INT */
      let I = [];
      I[0] = String.fromCharCode((i >> 24) & 0xff);
      I[1] = String.fromCharCode((i >> 16) & 0xff);
      I[2] = String.fromCharCode((i >> 8) & 0xff);
      I[3] = String.fromCharCode(i & 0xff);

      U[0] = Utils.digestBytes(S + I.join(''), h);
      for (let j = 1; j < c; j++) {
        U[j] = Utils.digestBytes(U[j - 1], h);
      }

      ret = U[0];
      for (j = 1; j < c; j++) {
        ret = Utils.byteArrayToString(XOR(ret, U[j]));
      }

      return ret;
    }
    
    let l = Math.ceil(dkLen / HLEN);
    let r = dkLen - ((l - 1) * HLEN);

    // Reuse the key and the hasher. Remaking them 4096 times is 'spensive.
    let h = Utils.makeHMACHasher(Ci.nsICryptoHMAC.SHA1, Utils.makeHMACKey(P));
    
    T = [];
    for (let i = 0; i < l;) {
      T[i] = F(S, c, ++i, h);
    }

    let ret = '';
    for (i = 0; i < l-1;) {
      ret += T[i++];
    }
    ret += T[l - 1].substr(0, r);

    return ret;
  },


  /**
   * Base32 decode (RFC 4648) a string.
   */
  decodeBase32: function decodeBase32(str) {
    const key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    let padChar = str.indexOf("=");
    let chars = (padChar == -1) ? str.length : padChar;
    let bytes = Math.floor(chars * 5 / 8);
    let blocks = Math.ceil(chars / 8);

    // Process a chunk of 5 bytes / 8 characters.
    // The processing of this is known in advance,
    // so avoid arithmetic!
    function processBlock(ret, cOffset, rOffset) {
      let c, val;

      // N.B., this relies on
      //   undefined | foo == foo.
      function accumulate(val) {
        ret[rOffset] |= val;
      }

      function advance() {
        c  = str[cOffset++];
        if (!c || c == "" || c == "=") // Easier than range checking.
          throw "Done";                // Will be caught far away.
        val = key.indexOf(c);
        if (val == -1)
          throw "Unknown character in base32: " + c;
      }

      // Handle a left shift, restricted to bytes.
      function left(octet, shift)
        (octet << shift) & 0xff;

      advance();
      accumulate(left(val, 3));
      advance();
      accumulate(val >> 2);
      ++rOffset;
      accumulate(left(val, 6));
      advance();
      accumulate(left(val, 1));
      advance();
      accumulate(val >> 4);
      ++rOffset;
      accumulate(left(val, 4));
      advance();
      accumulate(val >> 1);
      ++rOffset;
      accumulate(left(val, 7));
      advance();
      accumulate(left(val, 2));
      advance();
      accumulate(val >> 3);
      ++rOffset;
      accumulate(left(val, 5));
      advance();
      accumulate(val);
      ++rOffset;
    }

    // Our output. Define to be explicit (and maybe the compiler will be smart).
    let ret  = new Array(bytes);
    let i    = 0;
    let cOff = 0;
    let rOff = 0;

    for (; i < blocks; ++i) {
      try {
        processBlock(ret, cOff, rOff);
      } catch (ex) {
        // Handle the detection of padding.
        if (ex == "Done")
          break;
        throw ex;
      }
      cOff += 8;
      rOff += 5;
    }

    // Slice in case our shift overflowed to the right.
    return Utils.byteArrayToString(ret.slice(0, bytes));
  },

  /**
   * Base32 encode (RFC 4648) a string
   */
  encodeBase32: function encodeBase32(bytes) {
    const key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let quanta = Math.floor(bytes.length / 5);
    let leftover = bytes.length % 5;

    // Pad the last quantum with zeros so the length is a multiple of 5.
    if (leftover) {
      quanta += 1;
      for (let i = leftover; i < 5; i++)
        bytes += "\0";
    }

    // Chop the string into quanta of 5 bytes (40 bits). Each quantum
    // is turned into 8 characters from the 32 character base.
    let ret = "";
    for (let i = 0; i < bytes.length; i += 5) {
      let c = [byte.charCodeAt() for each (byte in bytes.slice(i, i + 5))];
      ret += key[c[0] >> 3]
           + key[((c[0] << 2) & 0x1f) | (c[1] >> 6)]
           + key[(c[1] >> 1) & 0x1f]
           + key[((c[1] << 4) & 0x1f) | (c[2] >> 4)]
           + key[((c[2] << 1) & 0x1f) | (c[3] >> 7)]
           + key[(c[3] >> 2) & 0x1f]
           + key[((c[3] << 3) & 0x1f) | (c[4] >> 5)]
           + key[c[4] & 0x1f];
    }

    switch (leftover) {
      case 1:
        return ret.slice(0, -6) + "======";
      case 2:
        return ret.slice(0, -4) + "====";
      case 3:
        return ret.slice(0, -3) + "===";
      case 4:
        return ret.slice(0, -1) + "=";
      default:
        return ret;
    }
  },

  /**
   * Turn RFC 4648 base32 into our own user-friendly version.
   *   ABCDEFGHIJKLMNOPQRSTUVWXYZ234567
   * becomes
   *   abcdefghijk8mn9pqrstuvwxyz234567
   */
  base32ToFriendly: function base32ToFriendly(input) {
    return input.toLowerCase()
                .replace("l", '8', "g")
                .replace("o", '9', "g");
  },

  base32FromFriendly: function base32FromFriendly(input) {
    return input.toUpperCase()
                .replace("8", 'L', "g")
                .replace("9", 'O', "g");
  },


  /**
   * Key manipulation.
   */

  // Return an octet string in friendly base32 *with no trailing =*.
  encodeKeyBase32: function encodeKeyBase32(keyData) {
    return Utils.base32ToFriendly(
             Utils.encodeBase32(keyData))
           .slice(0, SYNC_KEY_ENCODED_LENGTH);
  },

  decodeKeyBase32: function decodeKeyBase32(encoded) {
    return Utils.decodeBase32(
             Utils.base32FromFriendly(
               Utils.normalizePassphrase(encoded)))
           .slice(0, SYNC_KEY_DECODED_LENGTH);
  },

  base64Key: function base64Key(keyData) {
    return btoa(keyData);
  },

  deriveKeyFromPassphrase: function deriveKeyFromPassphrase(passphrase, salt, keyLength, forceJS) {
    if (Svc.Crypto.deriveKeyFromPassphrase && !forceJS) {
      return Svc.Crypto.deriveKeyFromPassphrase(passphrase, salt, keyLength);
    }
    else {
      // Fall back to JS implementation.
      // 4096 is hardcoded in WeaveCrypto, so do so here.
      return Utils.pbkdf2Generate(passphrase, atob(salt), 4096, keyLength);
    }
  },

  /**
   * N.B., salt should be base64 encoded, even though we have to decode
   * it later!
   */
  derivePresentableKeyFromPassphrase : function derivePresentableKeyFromPassphrase(passphrase, salt, keyLength, forceJS) {
    let k = Utils.deriveKeyFromPassphrase(passphrase, salt, keyLength, forceJS);
    return Utils.encodeKeyBase32(k);
  },

  /**
   * N.B., salt should be base64 encoded, even though we have to decode
   * it later!
   */
  deriveEncodedKeyFromPassphrase : function deriveEncodedKeyFromPassphrase(passphrase, salt, keyLength, forceJS) {
    let k = Utils.deriveKeyFromPassphrase(passphrase, salt, keyLength, forceJS);
    return Utils.base64Key(k);
  },

  /**
   * Take a base64-encoded 128-bit AES key, returning it as five groups of five
   * uppercase alphanumeric characters, separated by hyphens.
   * A.K.A. base64-to-base32 encoding.
   */
  presentEncodedKeyAsSyncKey : function presentEncodedKeyAsSyncKey(encodedKey) {
    return Utils.encodeKeyBase32(atob(encodedKey));
  },

  /**
   * Compute the HTTP MAC SHA-1 for an HTTP request.
   *
   * @param  identifier
   *         (string) MAC Key Identifier.
   * @param  key
   *         (string) MAC Key.
   * @param  method
   *         (string) HTTP request method.
   * @param  URI
   *         (nsIURI) HTTP request URI.
   * @param  extra
   *         (object) Optional extra parameters. Valid keys are:
   *           nonce_bytes - How many bytes the nonce should be. This defaults
   *             to 8. Note that this many bytes are Base64 encoded, so the
   *             string length of the nonce will be longer than this value.
   *           ts - Timestamp to use. Should only be defined for testing.
   *           nonce - String nonce. Should only be defined for testing as this
   *             function will generate a cryptographically secure random one
   *             if not defined.
   *           ext - Extra string to be included in MAC. Per the HTTP MAC spec,
   *             the format is undefined and thus application specific.
   * @returns
   *         (object) Contains results of operation and input arguments (for
   *           symmetry). The object has the following keys:
   *
   *           identifier - (string) MAC Key Identifier (from arguments).
   *           key - (string) MAC Key (from arguments).
   *           method - (string) HTTP request method (from arguments).
   *           hostname - (string) HTTP hostname used (derived from arguments).
   *           port - (string) HTTP port number used (derived from arguments).
   *           mac - (string) Raw HMAC digest bytes.
   *           getHeader - (function) Call to obtain the string Authorization
   *             header value for this invocation.
   *           nonce - (string) Nonce value used.
   *           ts - (number) Integer seconds since Unix epoch that was used.
   */
  computeHTTPMACSHA1: function computeHTTPMACSHA1(identifier, key, method,
                                                  uri, extra) {
    let ts = (extra && extra.ts) ? extra.ts : Math.floor(Date.now() / 1000);
    let nonce_bytes = (extra && extra.nonce_bytes > 0) ? extra.nonce_bytes : 8;

    // We are allowed to use more than the Base64 alphabet if we want.
    let nonce = (extra && extra.nonce)
                ? extra.nonce
                : btoa(Utils.generateRandomBytes(nonce_bytes));

    let host = uri.asciiHost;
    let port;
    let usedMethod = method.toUpperCase();

    if (uri.port != -1) {
      port = uri.port;
    } else if (uri.scheme == "http") {
      port = "80";
    } else if (uri.scheme == "https") {
      port = "443";
    } else {
      throw new Error("Unsupported URI scheme: " + uri.scheme);
    }

    let ext = (extra && extra.ext) ? extra.ext : "";

    let requestString = ts.toString(10) + "\n" +
                        nonce           + "\n" +
                        usedMethod      + "\n" +
                        uri.path        + "\n" +
                        host            + "\n" +
                        port            + "\n" +
                        ext             + "\n";

    let hasher = Utils.makeHMACHasher(Ci.nsICryptoHMAC.SHA1,
                                      Utils.makeHMACKey(key));
    let mac = Utils.digestBytes(requestString, hasher);

    function getHeader() {
      return Utils.getHTTPMACSHA1Header(this.identifier, this.ts, this.nonce,
                                        this.mac, this.ext);
    }

    return {
      identifier: identifier,
      key:        key,
      method:     usedMethod,
      hostname:   host,
      port:       port,
      mac:        mac,
      nonce:      nonce,
      ts:         ts,
      ext:        ext,
      getHeader:  getHeader
    };
  },

  /**
   * Obtain the HTTP MAC Authorization header value from fields.
   *
   * @param  identifier
   *         (string) MAC key identifier.
   * @param  ts
   *         (number) Integer seconds since Unix epoch.
   * @param  nonce
   *         (string) Nonce value.
   * @param  mac
   *         (string) Computed HMAC digest (raw bytes).
   * @param  ext
   *         (optional) (string) Extra string content.
   * @returns
   *         (string) Value to put in Authorization header.
   */
  getHTTPMACSHA1Header: function getHTTPMACSHA1Header(identifier, ts, nonce,
                                                      mac, ext) {
    let header ='MAC id="' + identifier + '", ' +
                'ts="'     + ts         + '", ' +
                'nonce="'  + nonce      + '", ' +
                'mac="'    + btoa(mac)  + '"';

    if (!ext) {
      return header;
    }

    return header += ', ext="' + ext +'"';
  },

  /**
   * Load a json object from disk
   *
   * @param filePath
   *        Json file path load from weave/[filePath].json
   * @param that
   *        Object to use for logging and "this" for callback
   * @param callback
   *        Function to process json object as its first parameter
   */
  jsonLoad: function Utils_jsonLoad(filePath, that, callback) {
    filePath = "weave/" + filePath + ".json";
    if (that._log)
      that._log.trace("Loading json from disk: " + filePath);

    let file = FileUtils.getFile("ProfD", filePath.split("/"), true);
    if (!file.exists()) {
      callback.call(that);
      return;
    }

    let channel = NetUtil.newChannel(file);
    channel.contentType = "application/json";

    NetUtil.asyncFetch(channel, function (is, result) {
      if (!Components.isSuccessCode(result)) {
        callback.call(that);
        return;
      }
      let string = NetUtil.readInputStreamToString(is, is.available());
      is.close();
      let json;
      try {
        json = JSON.parse(string);
      } catch (ex) {
        if (that._log)
          that._log.debug("Failed to load json: " + Utils.exceptionStr(ex));
      }
      callback.call(that, json);
    });
  },

  /**
   * Save a json-able object to disk
   *
   * @param filePath
   *        Json file path save to weave/[filePath].json
   * @param that
   *        Object to use for logging and "this" for callback
   * @param obj
   *        Function to provide json-able object to save. If this isn't a
   *        function, it'll be used as the object to make a json string.
   * @param callback
   *        Function called when the write has been performed. Optional.
   */
  jsonSave: function Utils_jsonSave(filePath, that, obj, callback) {
    filePath = "weave/" + filePath + ".json";
    if (that._log)
      that._log.trace("Saving json to disk: " + filePath);

    let file = FileUtils.getFile("ProfD", filePath.split("/"), true);
    let json = typeof obj == "function" ? obj.call(that) : obj;
    let out = JSON.stringify(json);

    let fos = FileUtils.openSafeFileOutputStream(file);
    let is = this._utf8Converter.convertToInputStream(out);
    NetUtil.asyncCopy(is, fos, function (result) {
      if (typeof callback == "function") {
        callback.call(that);        
      }
    });
  },

  getIcon: function(iconUri, defaultIcon) {
    try {
      let iconURI = Utils.makeURI(iconUri);
      return PlacesUtils.favicons.getFaviconLinkForIcon(iconURI).spec;
    }
    catch(ex) {}

    // Just give the provided default icon or the system's default
    return defaultIcon || PlacesUtils.favicons.defaultFavicon.spec;
  },

  getErrorString: function Utils_getErrorString(error, args) {
    try {
      return Str.errors.get(error, args || null);
    } catch (e) {}

    // basically returns "Unknown Error"
    return Str.errors.get("error.reason.unknown");
  },

  /**
   * Generate 26 characters.
   */
  generatePassphrase: function generatePassphrase() {
    // Note that this is a different base32 alphabet to the one we use for
    // other tasks. It's lowercase, uses different letters, and needs to be
    // decoded with decodeKeyBase32, not just decodeBase32.
    return Utils.encodeKeyBase32(Utils.generateRandomBytes(16));
  },

  /**
   * The following are the methods supported for UI use:
   *
   * * isPassphrase:
   *     determines whether a string is either a normalized or presentable
   *     passphrase.
   * * hyphenatePassphrase:
   *     present a normalized passphrase for display. This might actually
   *     perform work beyond just hyphenation; sorry.
   * * hyphenatePartialPassphrase:
   *     present a fragment of a normalized passphrase for display.
   * * normalizePassphrase:
   *     take a presentable passphrase and reduce it to a normalized
   *     representation for storage. normalizePassphrase can safely be called
   *     on normalized input.
   * * normalizeAccount:
   *     take user input for account/username, cleaning up appropriately.
   */

  isPassphrase: function(s) {
    if (s) {
      return /^[abcdefghijkmnpqrstuvwxyz23456789]{26}$/.test(Utils.normalizePassphrase(s));
    }
    return false;
  },

  /**
   * Hyphenate a passphrase (26 characters) into groups.
   * abbbbccccddddeeeeffffggggh
   * =>
   * a-bbbbc-cccdd-ddeee-effff-ggggh
   */
  hyphenatePassphrase: function hyphenatePassphrase(passphrase) {
    // For now, these are the same.
    return Utils.hyphenatePartialPassphrase(passphrase, true);
  },

  hyphenatePartialPassphrase: function hyphenatePartialPassphrase(passphrase, omitTrailingDash) {
    if (!passphrase)
      return null;

    // Get the raw data input. Just base32.
    let data = passphrase.toLowerCase().replace(/[^abcdefghijkmnpqrstuvwxyz23456789]/g, "");

    // This is the neatest way to do this.
    if ((data.length == 1) && !omitTrailingDash)
      return data + "-";

    // Hyphenate it.
    let y = data.substr(0,1);
    let z = data.substr(1).replace(/(.{1,5})/g, "-$1");

    // Correct length? We're done.
    if ((z.length == 30) || omitTrailingDash)
      return y + z;

    // Add a trailing dash if appropriate.
    return (y + z.replace(/([^-]{5})$/, "$1-")).substr(0, SYNC_KEY_HYPHENATED_LENGTH);
  },

  normalizePassphrase: function normalizePassphrase(pp) {
    // Short var name... have you seen the lines below?!
    // Allow leading and trailing whitespace.
    pp = pp.trim().toLowerCase();

    // 20-char sync key.
    if (pp.length == 23 &&
        [5, 11, 17].every(function(i) pp[i] == '-')) {

      return pp.slice(0, 5) + pp.slice(6, 11)
             + pp.slice(12, 17) + pp.slice(18, 23);
    }

    // "Modern" 26-char key.
    if (pp.length == 31 &&
        [1, 7, 13, 19, 25].every(function(i) pp[i] == '-')) {

      return pp.slice(0, 1) + pp.slice(2, 7)
             + pp.slice(8, 13) + pp.slice(14, 19)
             + pp.slice(20, 25) + pp.slice(26, 31);
    }

    // Something else -- just return.
    return pp;
  },
  
  normalizeAccount: function normalizeAccount(acc) {
    return acc.trim();
  },

  /**
   * Create an array like the first but without elements of the second. Reuse
   * arrays if possible.
   */
  arraySub: function arraySub(minuend, subtrahend) {
    if (!minuend.length || !subtrahend.length)
      return minuend;
    return minuend.filter(function(i) subtrahend.indexOf(i) == -1);
  },

  /**
   * Build the union of two arrays. Reuse arrays if possible.
   */
  arrayUnion: function arrayUnion(foo, bar) {
    if (!foo.length)
      return bar;
    if (!bar.length)
      return foo;
    return foo.concat(Utils.arraySub(bar, foo));
  },

  bind2: function Async_bind2(object, method) {
    return function innerBind() { return method.apply(object, arguments); };
  },

  mpLocked: function mpLocked() {
    let modules = Cc["@mozilla.org/security/pkcs11moduledb;1"]
                    .getService(Ci.nsIPKCS11ModuleDB);
    let sdrSlot = modules.findSlotByName("");
    let status  = sdrSlot.status;
    let slots = Ci.nsIPKCS11Slot;

    if (status == slots.SLOT_READY || status == slots.SLOT_LOGGED_IN
                                   || status == slots.SLOT_UNINITIALIZED)
      return false;

    if (status == slots.SLOT_NOT_LOGGED_IN)
      return true;
    
    // something wacky happened, pretend MP is locked
    return true;
  },

  // If Master Password is enabled and locked, present a dialog to unlock it.
  // Return whether the system is unlocked.
  ensureMPUnlocked: function ensureMPUnlocked() {
    if (!Utils.mpLocked()) {
      return true;
    }
    let sdr = Cc["@mozilla.org/security/sdr;1"]
                .getService(Ci.nsISecretDecoderRing);
    try {
      sdr.encryptString("bacon");
      return true;
    } catch(e) {}
    return false;
  },
  
  /**
   * Return a value for a backoff interval.  Maximum is eight hours, unless
   * Status.backoffInterval is higher.
   *
   */
  calculateBackoff: function calculateBackoff(attempts, baseInterval,
                                              statusInterval) {
    let backoffInterval = attempts *
                          (Math.floor(Math.random() * baseInterval) +
                           baseInterval);
    return Math.max(Math.min(backoffInterval, MAXIMUM_BACKOFF_INTERVAL),
                    statusInterval);
  },
};

XPCOMUtils.defineLazyGetter(Utils, "_utf8Converter", function() {
  let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                    .createInstance(Ci.nsIScriptableUnicodeConverter);
  converter.charset = "UTF-8";
  return converter;
});

/*
 * Commonly-used services
 */
let Svc = {};
Svc.Prefs = new Preferences(PREFS_BRANCH);
Svc.DefaultPrefs = new Preferences({branch: PREFS_BRANCH, defaultBranch: true});
Svc.Obs = Observers;

let _sessionCID = Services.appinfo.ID == SEAMONKEY_ID ?
  "@mozilla.org/suite/sessionstore;1" :
  "@mozilla.org/browser/sessionstore;1";

[["Form", "@mozilla.org/satchel/form-history;1", "nsIFormHistory2"],
 ["Idle", "@mozilla.org/widget/idleservice;1", "nsIIdleService"],
 ["KeyFactory", "@mozilla.org/security/keyobjectfactory;1", "nsIKeyObjectFactory"],
 ["Session", _sessionCID, "nsISessionStore"]
].forEach(function([name, contract, iface]) {
  XPCOMUtils.defineLazyServiceGetter(Svc, name, contract, iface);
});

// nsIPrivateBrowsingService is not implemented in mobile Firefox.
// Svc.Private should just return undefined in this case instead of throwing.
XPCOMUtils.defineLazyGetter(Svc, "Private", function() {
  try {
    return Cc["@mozilla.org/privatebrowsing;1"].getService(Ci["nsIPrivateBrowsingService"]);
  } catch (e) {
    return undefined;
  }
});

Svc.__defineGetter__("Crypto", function() {
  let cryptoSvc;
  let ns = {};
  Cu.import("resource://services-crypto/WeaveCrypto.js", ns);
  cryptoSvc = new ns.WeaveCrypto();
  delete Svc.Crypto;
  return Svc.Crypto = cryptoSvc;
});

let Str = {};
["errors", "sync"].forEach(function(lazy) {
  XPCOMUtils.defineLazyGetter(Str, lazy, Utils.lazyStrings(lazy));
});

Svc.Obs.add("xpcom-shutdown", function () {
  for (let name in Svc)
    delete Svc[name];
});
