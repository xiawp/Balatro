
var Module;

if (typeof Module === 'undefined') Module = eval('(function() { try { return Module || {} } catch(e) { return {} } })()');

if (!Module.expectedDataFileDownloads) {
  Module.expectedDataFileDownloads = 0;
  Module.finishedDataFileDownloads = 0;
}
Module.expectedDataFileDownloads++;
(function() {
 var loadPackage = function(metadata) {

  var PACKAGE_PATH;
  if (typeof window === 'object') {
    PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.toString().substring(0, window.location.pathname.toString().lastIndexOf('/')) + '/');
  } else if (typeof location !== 'undefined') {
      // worker
      PACKAGE_PATH = encodeURIComponent(location.pathname.toString().substring(0, location.pathname.toString().lastIndexOf('/')) + '/');
    } else {
      throw 'using preloaded data can only be done on a web page or in a web worker';
    }
    var PACKAGE_NAME = 'game.data';
    var REMOTE_PACKAGE_BASE = 'game.data';
    if (typeof Module['locateFilePackage'] === 'function' && !Module['locateFile']) {
      Module['locateFile'] = Module['locateFilePackage'];
      Module.printErr('warning: you defined Module.locateFilePackage, that has been renamed to Module.locateFile (using your locateFilePackage for now)');
    }
    var REMOTE_PACKAGE_NAME = typeof Module['locateFile'] === 'function' ?
    Module['locateFile'](REMOTE_PACKAGE_BASE) :
    ((Module['filePackagePrefixURL'] || '') + REMOTE_PACKAGE_BASE);

    var REMOTE_PACKAGE_SIZE = metadata.remote_package_size;
    var PACKAGE_UUID = metadata.package_uuid;

    function fetchRemotePackage(packageName, packageSize, callback, errback) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', packageName, true);
      xhr.responseType = 'arraybuffer';
      xhr.onprogress = function(event) {
        var url = packageName;
        var size = packageSize;
        if (event.total) size = event.total;
        if (event.loaded) {
          if (!xhr.addedTotal) {
            xhr.addedTotal = true;
            if (!Module.dataFileDownloads) Module.dataFileDownloads = {};
            Module.dataFileDownloads[url] = {
              loaded: event.loaded,
              total: size
            };
          } else {
            Module.dataFileDownloads[url].loaded = event.loaded;
          }
          var total = 0;
          var loaded = 0;
          var num = 0;
          for (var download in Module.dataFileDownloads) {
            var data = Module.dataFileDownloads[download];
            total += data.total;
            loaded += data.loaded;
            num++;
          }
          total = Math.ceil(total * Module.expectedDataFileDownloads/num);
          if (Module['setStatus']) Module['setStatus']('Downloading data... (' + loaded + '/' + total + ')');
        } else if (!Module.dataFileDownloads) {
          if (Module['setStatus']) Module['setStatus']('Downloading data...');
        }
      };
      xhr.onerror = function(event) {
        throw new Error("NetworkError for: " + packageName);
      }
      xhr.onload = function(event) {
        if (xhr.status == 200 || xhr.status == 304 || xhr.status == 206 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
          var packageData = xhr.response;
          callback(packageData);
        } else {
          throw new Error(xhr.statusText + " : " + xhr.responseURL);
        }
      };
      xhr.send(null);
    };

    function handleError(error) {
      console.error('package error:', error);
    };

    function runWithFS() {

      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
      

      function DataRequest(start, end, crunched, audio) {
        this.start = start;
        this.end = end;
        this.crunched = crunched;
        this.audio = audio;
      }
      DataRequest.prototype = {
        requests: {},
        open: function(mode, name) {
          this.name = name;
          var parentDir = name.substring(0, name.lastIndexOf('/'));
          if (parentDir && Module['FS_createPath']) {
            Module['FS_createPath']('/', parentDir.replace(/^\/+/, ''), true, true);
          }
          this.requests[name] = this;
          Module['addRunDependency']('fp ' + this.name);
        },
        send: function() {},
        onload: function() {
          var byteArray = this.byteArray.subarray(this.start, this.end);

          this.finish(byteArray);

        },
        finish: function(byteArray) {
          var that = this;

        Module['FS_createDataFile'](this.name, null, byteArray, true, true, true); // canOwn this data in the filesystem, it is a slide into the heap that will never change
        Module['removeRunDependency']('fp ' + that.name);

        this.requests[this.name] = null;
      }
    };

    var files = metadata.files;
    for (i = 0; i < files.length; ++i) {
      new DataRequest(files[i].start, files[i].end, files[i].crunched, files[i].audio).open('GET', files[i].filename);
    }


    var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
    var IDB_RO = "readonly";
    var IDB_RW = "readwrite";
    var DB_NAME = "EM_PRELOAD_CACHE";
    var DB_VERSION = 1;
    var METADATA_STORE_NAME = 'METADATA';
    var PACKAGE_STORE_NAME = 'PACKAGES';
    function openDatabase(callback, errback) {
      try {
        var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return errback(e);
      }
      openRequest.onupgradeneeded = function(event) {
        var db = event.target.result;

        if(db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
          db.deleteObjectStore(PACKAGE_STORE_NAME);
        }
        var packages = db.createObjectStore(PACKAGE_STORE_NAME);

        if(db.objectStoreNames.contains(METADATA_STORE_NAME)) {
          db.deleteObjectStore(METADATA_STORE_NAME);
        }
        var metadata = db.createObjectStore(METADATA_STORE_NAME);
      };
      openRequest.onsuccess = function(event) {
        var db = event.target.result;
        callback(db);
      };
      openRequest.onerror = function(error) {
        errback(error);
      };
    };

    /* Check if there's a cached package, and if so whether it's the latest available */
    function checkCachedPackage(db, packageName, callback, errback) {
      var transaction = db.transaction([METADATA_STORE_NAME], IDB_RO);
      var metadata = transaction.objectStore(METADATA_STORE_NAME);

      var getRequest = metadata.get("metadata/" + packageName);
      getRequest.onsuccess = function(event) {
        var result = event.target.result;
        if (!result) {
          return callback(false);
        } else {
          return callback(PACKAGE_UUID === result.uuid);
        }
      };
      getRequest.onerror = function(error) {
        errback(error);
      };
    };

    function fetchCachedPackage(db, packageName, callback, errback) {
      var transaction = db.transaction([PACKAGE_STORE_NAME], IDB_RO);
      var packages = transaction.objectStore(PACKAGE_STORE_NAME);

      var getRequest = packages.get("package/" + packageName);
      getRequest.onsuccess = function(event) {
        var result = event.target.result;
        callback(result);
      };
      getRequest.onerror = function(error) {
        errback(error);
      };
    };

    function cacheRemotePackage(db, packageName, packageData, packageMeta, callback, errback) {
      var transaction_packages = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
      var packages = transaction_packages.objectStore(PACKAGE_STORE_NAME);

      var putPackageRequest = packages.put(packageData, "package/" + packageName);
      putPackageRequest.onsuccess = function(event) {
        var transaction_metadata = db.transaction([METADATA_STORE_NAME], IDB_RW);
        var metadata = transaction_metadata.objectStore(METADATA_STORE_NAME);
        var putMetadataRequest = metadata.put(packageMeta, "metadata/" + packageName);
        putMetadataRequest.onsuccess = function(event) {
          callback(packageData);
        };
        putMetadataRequest.onerror = function(error) {
          errback(error);
        };
      };
      putPackageRequest.onerror = function(error) {
        errback(error);
      };
    };

    function processPackageData(arrayBuffer) {
      Module.finishedDataFileDownloads++;
      assert(arrayBuffer, 'Loading data file failed.');
      assert(arrayBuffer instanceof ArrayBuffer, 'bad input to processPackageData');
      var byteArray = new Uint8Array(arrayBuffer);
      var curr;

        // copy the entire loaded file into a spot in the heap. Files will refer to slices in that. They cannot be freed though
        // (we may be allocating before malloc is ready, during startup).
        if (Module['SPLIT_MEMORY']) Module.printErr('warning: you should run the file packager with --no-heap-copy when SPLIT_MEMORY is used, otherwise copying into the heap may fail due to the splitting');
        var ptr = Module['getMemory'](byteArray.length);
        Module['HEAPU8'].set(byteArray, ptr);
        DataRequest.prototype.byteArray = Module['HEAPU8'].subarray(ptr, ptr+byteArray.length);

        var files = metadata.files;
        for (i = 0; i < files.length; ++i) {
          DataRequest.prototype.requests[files[i].filename].onload();
        }
        Module['removeRunDependency']('datafile_game.data');

      };
      Module['addRunDependency']('datafile_game.data');

      if (!Module.preloadResults) Module.preloadResults = {};

      function preloadFallback(error) {
        console.error(error);
        console.error('falling back to default preload behavior');
        fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, processPackageData, handleError);
      };

      openDatabase(
        function(db) {
          checkCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME,
            function(useCached) {
              Module.preloadResults[PACKAGE_NAME] = {fromCache: useCached};
              if (useCached) {
                console.info('loading ' + PACKAGE_NAME + ' from cache');
                fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, processPackageData, preloadFallback);
              } else {
                console.info('loading ' + PACKAGE_NAME + ' from remote');
                fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE,
                  function(packageData) {
                    cacheRemotePackage(db, PACKAGE_PATH + PACKAGE_NAME, packageData, {uuid:PACKAGE_UUID}, processPackageData,
                      function(error) {
                        console.error(error);
                        processPackageData(packageData);
                      });
                  }
                  , preloadFallback);
              }
            }
            , preloadFallback);
        }
        , preloadFallback);

      if (Module['setStatus']) Module['setStatus']('Downloading...');

    }
    if (Module['calledRun']) {
      runWithFS();
    } else {
      if (!Module['preRun']) Module['preRun'] = [];
      Module["preRun"].push(runWithFS); // FS is not initialized yet, wait for it
    }

  }
  loadPackage({"package_uuid":"54fb77e5-7a07-4432-a36e-a5a1f56c8516","remote_package_size":29474199,"files":[{"filename":"/game.love/back.lua","crunched":0,"start":0,"end":12555,"audio":false},{"filename":"/game.love/bit.lua","crunched":0,"start":12555,"end":16452,"audio":false},{"filename":"/game.love/blind.lua","crunched":0,"start":16452,"end":43986,"audio":false},{"filename":"/game.love/card.lua","crunched":0,"start":43986,"end":286537,"audio":false},{"filename":"/game.love/card_character.lua","crunched":0,"start":286537,"end":291895,"audio":false},{"filename":"/game.love/cardarea.lua","crunched":0,"start":291895,"end":323977,"audio":false},{"filename":"/game.love/challenges.lua","crunched":0,"start":323977,"end":347909,"audio":false},{"filename":"/game.love/conf.lua","crunched":0,"start":347909,"end":348225,"audio":false},{"filename":"/game.love/engine/animatedsprite.lua","crunched":0,"start":348225,"end":351497,"audio":false},{"filename":"/game.love/engine/controller.lua","crunched":0,"start":351497,"end":412151,"audio":false},{"filename":"/game.love/engine/event.lua","crunched":0,"start":412151,"end":419185,"audio":false},{"filename":"/game.love/engine/http_manager.lua","crunched":0,"start":419185,"end":419855,"audio":false},{"filename":"/game.love/engine/moveable.lua","crunched":0,"start":419855,"end":440386,"audio":false},{"filename":"/game.love/engine/node.lua","crunched":0,"start":440386,"end":456103,"audio":false},{"filename":"/game.love/engine/object.lua","crunched":0,"start":456103,"end":456769,"audio":false},{"filename":"/game.love/engine/particles.lua","crunched":0,"start":456769,"end":463364,"audio":false},{"filename":"/game.love/engine/profile.lua","crunched":0,"start":463364,"end":467937,"audio":false},{"filename":"/game.love/engine/save_manager.lua","crunched":0,"start":467937,"end":471758,"audio":false},{"filename":"/game.love/engine/sound_manager.lua","crunched":0,"start":471758,"end":478606,"audio":false},{"filename":"/game.love/engine/sprite.lua","crunched":0,"start":478606,"end":486572,"audio":false},{"filename":"/game.love/engine/string_packer.lua","crunched":0,"start":486572,"end":489352,"audio":false},{"filename":"/game.love/engine/text.lua","crunched":0,"start":489352,"end":504308,"audio":false},{"filename":"/game.love/engine/ui.lua","crunched":0,"start":504308,"end":549605,"audio":false},{"filename":"/game.love/functions/UI_definitions.lua","crunched":0,"start":549605,"end":899428,"audio":false},{"filename":"/game.love/functions/button_callbacks.lua","crunched":0,"start":899428,"end":1016831,"audio":false},{"filename":"/game.love/functions/common_events.lua","crunched":0,"start":1016831,"end":1147489,"audio":false},{"filename":"/game.love/functions/misc_functions.lua","crunched":0,"start":1147489,"end":1221294,"audio":false},{"filename":"/game.love/functions/state_events.lua","crunched":0,"start":1221294,"end":1297256,"audio":false},{"filename":"/game.love/functions/test_functions.lua","crunched":0,"start":1297256,"end":1305405,"audio":false},{"filename":"/game.love/game.lua","crunched":0,"start":1305405,"end":1542394,"audio":false},{"filename":"/game.love/globals.lua","crunched":0,"start":1542394,"end":1559022,"audio":false},{"filename":"/game.love/localization/de.lua","crunched":0,"start":1559022,"end":1713703,"audio":false},{"filename":"/game.love/localization/en-us.lua","crunched":0,"start":1713703,"end":1860389,"audio":false},{"filename":"/game.love/localization/es_419.lua","crunched":0,"start":1860389,"end":2013951,"audio":false},{"filename":"/game.love/localization/es_ES.lua","crunched":0,"start":2013951,"end":2167621,"audio":false},{"filename":"/game.love/localization/fr.lua","crunched":0,"start":2167621,"end":2325171,"audio":false},{"filename":"/game.love/localization/id.lua","crunched":0,"start":2325171,"end":2476828,"audio":false},{"filename":"/game.love/localization/it.lua","crunched":0,"start":2476828,"end":2628694,"audio":false},{"filename":"/game.love/localization/ja.lua","crunched":0,"start":2628694,"end":2797091,"audio":false},{"filename":"/game.love/localization/ko.lua","crunched":0,"start":2797091,"end":2957164,"audio":false},{"filename":"/game.love/localization/nl.lua","crunched":0,"start":2957164,"end":3109935,"audio":false},{"filename":"/game.love/localization/pl.lua","crunched":0,"start":3109935,"end":3264821,"audio":false},{"filename":"/game.love/localization/pt_BR.lua","crunched":0,"start":3264821,"end":3418203,"audio":false},{"filename":"/game.love/localization/ru.lua","crunched":0,"start":3418203,"end":3600074,"audio":false},{"filename":"/game.love/localization/zh_CN.lua","crunched":0,"start":3600074,"end":3747481,"audio":false},{"filename":"/game.love/localization/zh_TW.lua","crunched":0,"start":3747481,"end":3894523,"audio":false},{"filename":"/game.love/main.lua","crunched":0,"start":3894523,"end":3906177,"audio":false},{"filename":"/game.love/resources/fonts/GoNotoCJKCore.ttf","crunched":0,"start":3906177,"end":5073057,"audio":false},{"filename":"/game.love/resources/fonts/GoNotoCurrent-Bold.ttf","crunched":0,"start":5073057,"end":6146193,"audio":false},{"filename":"/game.love/resources/fonts/NotoSans-Bold.ttf","crunched":0,"start":6146193,"end":6187061,"audio":false},{"filename":"/game.love/resources/fonts/NotoSansJP-Bold.ttf","crunched":0,"start":6187061,"end":6553205,"audio":false},{"filename":"/game.love/resources/fonts/NotoSansKR-Bold.ttf","crunched":0,"start":6553205,"end":6767309,"audio":false},{"filename":"/game.love/resources/fonts/NotoSansSC-Bold.ttf","crunched":0,"start":6767309,"end":7148817,"audio":false},{"filename":"/game.love/resources/fonts/NotoSansTC-Bold.ttf","crunched":0,"start":7148817,"end":7554933,"audio":false},{"filename":"/game.love/resources/fonts/m6x11plus.ttf","crunched":0,"start":7554933,"end":7589998,"audio":false},{"filename":"/game.love/resources/gamecontrollerdb.txt","crunched":0,"start":7589998,"end":7987822,"audio":false},{"filename":"/game.love/resources/shaders/CRT.fs","crunched":0,"start":7987822,"end":7995092,"audio":false},{"filename":"/game.love/resources/shaders/background.fs","crunched":0,"start":7995092,"end":7997612,"audio":false},{"filename":"/game.love/resources/shaders/booster.fs","crunched":0,"start":7997612,"end":8002935,"audio":false},{"filename":"/game.love/resources/shaders/debuff.fs","crunched":0,"start":8002935,"end":8008099,"audio":false},{"filename":"/game.love/resources/shaders/dissolve.fs","crunched":0,"start":8008099,"end":8012368,"audio":false},{"filename":"/game.love/resources/shaders/flame.fs","crunched":0,"start":8012368,"end":8015217,"audio":false},{"filename":"/game.love/resources/shaders/flash.fs","crunched":0,"start":8015217,"end":8016118,"audio":false},{"filename":"/game.love/resources/shaders/foil.fs","crunched":0,"start":8016118,"end":8022053,"audio":false},{"filename":"/game.love/resources/shaders/gold_seal.fs","crunched":0,"start":8022053,"end":8022854,"audio":false},{"filename":"/game.love/resources/shaders/holo.fs","crunched":0,"start":8022854,"end":8028861,"audio":false},{"filename":"/game.love/resources/shaders/hologram.fs","crunched":0,"start":8028861,"end":8034415,"audio":false},{"filename":"/game.love/resources/shaders/negative.fs","crunched":0,"start":8034415,"end":8039309,"audio":false},{"filename":"/game.love/resources/shaders/negative_shine.fs","crunched":0,"start":8039309,"end":8044219,"audio":false},{"filename":"/game.love/resources/shaders/played.fs","crunched":0,"start":8044219,"end":8049009,"audio":false},{"filename":"/game.love/resources/shaders/polychrome.fs","crunched":0,"start":8049009,"end":8054835,"audio":false},{"filename":"/game.love/resources/shaders/skew.fs","crunched":0,"start":8054835,"end":8055506,"audio":false},{"filename":"/game.love/resources/shaders/splash.fs","crunched":0,"start":8055506,"end":8058113,"audio":false},{"filename":"/game.love/resources/shaders/vortex.fs","crunched":0,"start":8058113,"end":8058924,"audio":false},{"filename":"/game.love/resources/shaders/voucher.fs","crunched":0,"start":8058924,"end":8063753,"audio":false},{"filename":"/game.love/resources/sounds/ambientFire1.ogg","crunched":0,"start":8063753,"end":8542084,"audio":false},{"filename":"/game.love/resources/sounds/ambientFire2.ogg","crunched":0,"start":8542084,"end":9050581,"audio":false},{"filename":"/game.love/resources/sounds/ambientFire3.ogg","crunched":0,"start":9050581,"end":9554138,"audio":false},{"filename":"/game.love/resources/sounds/ambientOrgan1.ogg","crunched":0,"start":9554138,"end":9935091,"audio":false},{"filename":"/game.love/resources/sounds/button.ogg","crunched":0,"start":9935091,"end":9943224,"audio":false},{"filename":"/game.love/resources/sounds/cancel.ogg","crunched":0,"start":9943224,"end":9953304,"audio":false},{"filename":"/game.love/resources/sounds/card1.ogg","crunched":0,"start":9953304,"end":9967242,"audio":false},{"filename":"/game.love/resources/sounds/card3.ogg","crunched":0,"start":9967242,"end":9979114,"audio":false},{"filename":"/game.love/resources/sounds/cardFan2.ogg","crunched":0,"start":9979114,"end":9995583,"audio":false},{"filename":"/game.love/resources/sounds/cardSlide1.ogg","crunched":0,"start":9995583,"end":10006511,"audio":false},{"filename":"/game.love/resources/sounds/cardSlide2.ogg","crunched":0,"start":10006511,"end":10016394,"audio":false},{"filename":"/game.love/resources/sounds/chips1.ogg","crunched":0,"start":10016394,"end":10025378,"audio":false},{"filename":"/game.love/resources/sounds/chips2.ogg","crunched":0,"start":10025378,"end":10037495,"audio":false},{"filename":"/game.love/resources/sounds/coin1.ogg","crunched":0,"start":10037495,"end":10048804,"audio":false},{"filename":"/game.love/resources/sounds/coin2.ogg","crunched":0,"start":10048804,"end":10058530,"audio":false},{"filename":"/game.love/resources/sounds/coin3.ogg","crunched":0,"start":10058530,"end":10070193,"audio":false},{"filename":"/game.love/resources/sounds/coin4.ogg","crunched":0,"start":10070193,"end":10080718,"audio":false},{"filename":"/game.love/resources/sounds/coin5.ogg","crunched":0,"start":10080718,"end":10093820,"audio":false},{"filename":"/game.love/resources/sounds/coin6.ogg","crunched":0,"start":10093820,"end":10111871,"audio":false},{"filename":"/game.love/resources/sounds/coin7.ogg","crunched":0,"start":10111871,"end":10123186,"audio":false},{"filename":"/game.love/resources/sounds/crumple1.ogg","crunched":0,"start":10123186,"end":10137370,"audio":false},{"filename":"/game.love/resources/sounds/crumple2.ogg","crunched":0,"start":10137370,"end":10151706,"audio":false},{"filename":"/game.love/resources/sounds/crumple3.ogg","crunched":0,"start":10151706,"end":10164990,"audio":false},{"filename":"/game.love/resources/sounds/crumple4.ogg","crunched":0,"start":10164990,"end":10178122,"audio":false},{"filename":"/game.love/resources/sounds/crumple5.ogg","crunched":0,"start":10178122,"end":10191928,"audio":false},{"filename":"/game.love/resources/sounds/crumpleLong1.ogg","crunched":0,"start":10191928,"end":10243066,"audio":false},{"filename":"/game.love/resources/sounds/crumpleLong2.ogg","crunched":0,"start":10243066,"end":10297808,"audio":false},{"filename":"/game.love/resources/sounds/explosion1.ogg","crunched":0,"start":10297808,"end":10346234,"audio":false},{"filename":"/game.love/resources/sounds/explosion_buildup1.ogg","crunched":0,"start":10346234,"end":10378085,"audio":false},{"filename":"/game.love/resources/sounds/explosion_release1.ogg","crunched":0,"start":10378085,"end":10410083,"audio":false},{"filename":"/game.love/resources/sounds/foil1.ogg","crunched":0,"start":10410083,"end":10418849,"audio":false},{"filename":"/game.love/resources/sounds/foil2.ogg","crunched":0,"start":10418849,"end":10428391,"audio":false},{"filename":"/game.love/resources/sounds/generic1.ogg","crunched":0,"start":10428391,"end":10435526,"audio":false},{"filename":"/game.love/resources/sounds/glass1.ogg","crunched":0,"start":10435526,"end":10452480,"audio":false},{"filename":"/game.love/resources/sounds/glass2.ogg","crunched":0,"start":10452480,"end":10469277,"audio":false},{"filename":"/game.love/resources/sounds/glass3.ogg","crunched":0,"start":10469277,"end":10485849,"audio":false},{"filename":"/game.love/resources/sounds/glass4.ogg","crunched":0,"start":10485849,"end":10503353,"audio":false},{"filename":"/game.love/resources/sounds/glass5.ogg","crunched":0,"start":10503353,"end":10520488,"audio":false},{"filename":"/game.love/resources/sounds/glass6.ogg","crunched":0,"start":10520488,"end":10538533,"audio":false},{"filename":"/game.love/resources/sounds/gold_seal.ogg","crunched":0,"start":10538533,"end":10551817,"audio":false},{"filename":"/game.love/resources/sounds/gong.ogg","crunched":0,"start":10551817,"end":10569962,"audio":false},{"filename":"/game.love/resources/sounds/highlight1.ogg","crunched":0,"start":10569962,"end":10577149,"audio":false},{"filename":"/game.love/resources/sounds/highlight2.ogg","crunched":0,"start":10577149,"end":10590533,"audio":false},{"filename":"/game.love/resources/sounds/holo1.ogg","crunched":0,"start":10590533,"end":10603088,"audio":false},{"filename":"/game.love/resources/sounds/introPad1.ogg","crunched":0,"start":10603088,"end":10937106,"audio":false},{"filename":"/game.love/resources/sounds/magic_crumple.ogg","crunched":0,"start":10937106,"end":11023235,"audio":false},{"filename":"/game.love/resources/sounds/magic_crumple2.ogg","crunched":0,"start":11023235,"end":11058565,"audio":false},{"filename":"/game.love/resources/sounds/magic_crumple3.ogg","crunched":0,"start":11058565,"end":11082995,"audio":false},{"filename":"/game.love/resources/sounds/multhit1.ogg","crunched":0,"start":11082995,"end":11095077,"audio":false},{"filename":"/game.love/resources/sounds/multhit2.ogg","crunched":0,"start":11095077,"end":11110029,"audio":false},{"filename":"/game.love/resources/sounds/music1.ogg","crunched":0,"start":11110029,"end":14048771,"audio":false},{"filename":"/game.love/resources/sounds/music2.ogg","crunched":0,"start":14048771,"end":16664040,"audio":false},{"filename":"/game.love/resources/sounds/music3.ogg","crunched":0,"start":16664040,"end":19175098,"audio":false},{"filename":"/game.love/resources/sounds/music4.ogg","crunched":0,"start":19175098,"end":21983495,"audio":false},{"filename":"/game.love/resources/sounds/music5.ogg","crunched":0,"start":21983495,"end":24829323,"audio":false},{"filename":"/game.love/resources/sounds/negative.ogg","crunched":0,"start":24829323,"end":24842521,"audio":false},{"filename":"/game.love/resources/sounds/other1.ogg","crunched":0,"start":24842521,"end":24854669,"audio":false},{"filename":"/game.love/resources/sounds/paper1.ogg","crunched":0,"start":24854669,"end":24859941,"audio":false},{"filename":"/game.love/resources/sounds/polychrome1.ogg","crunched":0,"start":24859941,"end":24889962,"audio":false},{"filename":"/game.love/resources/sounds/slice1.ogg","crunched":0,"start":24889962,"end":24898459,"audio":false},{"filename":"/game.love/resources/sounds/splash_buildup.ogg","crunched":0,"start":24898459,"end":25238018,"audio":false},{"filename":"/game.love/resources/sounds/tarot1.ogg","crunched":0,"start":25238018,"end":25247139,"audio":false},{"filename":"/game.love/resources/sounds/tarot2.ogg","crunched":0,"start":25247139,"end":25257961,"audio":false},{"filename":"/game.love/resources/sounds/timpani.ogg","crunched":0,"start":25257961,"end":25272152,"audio":false},{"filename":"/game.love/resources/sounds/voice1.ogg","crunched":0,"start":25272152,"end":25279236,"audio":false},{"filename":"/game.love/resources/sounds/voice10.ogg","crunched":0,"start":25279236,"end":25286327,"audio":false},{"filename":"/game.love/resources/sounds/voice11.ogg","crunched":0,"start":25286327,"end":25293316,"audio":false},{"filename":"/game.love/resources/sounds/voice2.ogg","crunched":0,"start":25293316,"end":25300336,"audio":false},{"filename":"/game.love/resources/sounds/voice3.ogg","crunched":0,"start":25300336,"end":25307435,"audio":false},{"filename":"/game.love/resources/sounds/voice4.ogg","crunched":0,"start":25307435,"end":25314798,"audio":false},{"filename":"/game.love/resources/sounds/voice5.ogg","crunched":0,"start":25314798,"end":25321993,"audio":false},{"filename":"/game.love/resources/sounds/voice6.ogg","crunched":0,"start":25321993,"end":25329112,"audio":false},{"filename":"/game.love/resources/sounds/voice7.ogg","crunched":0,"start":25329112,"end":25336173,"audio":false},{"filename":"/game.love/resources/sounds/voice8.ogg","crunched":0,"start":25336173,"end":25343337,"audio":false},{"filename":"/game.love/resources/sounds/voice9.ogg","crunched":0,"start":25343337,"end":25350503,"audio":false},{"filename":"/game.love/resources/sounds/whoosh.ogg","crunched":0,"start":25350503,"end":25360415,"audio":false},{"filename":"/game.love/resources/sounds/whoosh1.ogg","crunched":0,"start":25360415,"end":25373317,"audio":false},{"filename":"/game.love/resources/sounds/whoosh2.ogg","crunched":0,"start":25373317,"end":25386165,"audio":false},{"filename":"/game.love/resources/sounds/whoosh_long.ogg","crunched":0,"start":25386165,"end":25500346,"audio":false},{"filename":"/game.love/resources/sounds/win.ogg","crunched":0,"start":25500346,"end":25536912,"audio":false},{"filename":"/game.love/resources/textures/1x/8BitDeck.png","crunched":0,"start":25536912,"end":25583790,"audio":false},{"filename":"/game.love/resources/textures/1x/8BitDeck_opt2.png","crunched":0,"start":25583790,"end":25645927,"audio":false},{"filename":"/game.love/resources/textures/1x/BlindChips.png","crunched":0,"start":25645927,"end":25729739,"audio":false},{"filename":"/game.love/resources/textures/1x/Enhancers.png","crunched":0,"start":25729739,"end":25805691,"audio":false},{"filename":"/game.love/resources/textures/1x/Jokers.png","crunched":0,"start":25805691,"end":26310378,"audio":false},{"filename":"/game.love/resources/textures/1x/ShopSignAnimation.png","crunched":0,"start":26310378,"end":26321176,"audio":false},{"filename":"/game.love/resources/textures/1x/Tarots.png","crunched":0,"start":26321176,"end":26417507,"audio":false},{"filename":"/game.love/resources/textures/1x/Vouchers.png","crunched":0,"start":26417507,"end":26488216,"audio":false},{"filename":"/game.love/resources/textures/1x/balatro.png","crunched":0,"start":26488216,"end":26515093,"audio":false},{"filename":"/game.love/resources/textures/1x/balatro_alt.png","crunched":0,"start":26515093,"end":26535919,"audio":false},{"filename":"/game.love/resources/textures/1x/boosters.png","crunched":0,"start":26535919,"end":26706537,"audio":false},{"filename":"/game.love/resources/textures/1x/chips.png","crunched":0,"start":26706537,"end":26714792,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_AC_1.png","crunched":0,"start":26714792,"end":26723171,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_AC_2.png","crunched":0,"start":26723171,"end":26731486,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_AU_1.png","crunched":0,"start":26731486,"end":26736518,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_AU_2.png","crunched":0,"start":26736518,"end":26743822,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_BUG_1.png","crunched":0,"start":26743822,"end":26754974,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_BUG_2.png","crunched":0,"start":26754974,"end":26767694,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_C7_1.png","crunched":0,"start":26767694,"end":26777497,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_C7_2.png","crunched":0,"start":26777497,"end":26787176,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_CL_1.png","crunched":0,"start":26787176,"end":26793659,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_CL_2.png","crunched":0,"start":26793659,"end":26801921,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_CR_1.png","crunched":0,"start":26801921,"end":26810088,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_CR_2.png","crunched":0,"start":26810088,"end":26819089,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_CYP_1.png","crunched":0,"start":26819089,"end":26826353,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_CYP_2.png","crunched":0,"start":26826353,"end":26833675,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_D2_1.png","crunched":0,"start":26833675,"end":26841389,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_D2_2.png","crunched":0,"start":26841389,"end":26850230,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_DBD_1.png","crunched":0,"start":26850230,"end":26858917,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_DBD_2.png","crunched":0,"start":26858917,"end":26868006,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_DS_1.png","crunched":0,"start":26868006,"end":26875804,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_DS_2.png","crunched":0,"start":26875804,"end":26883535,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_DTD_1.png","crunched":0,"start":26883535,"end":26890969,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_DTD_2.png","crunched":0,"start":26890969,"end":26896931,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_EG_1.png","crunched":0,"start":26896931,"end":26901664,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_EG_2.png","crunched":0,"start":26901664,"end":26906863,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_FO_1.png","crunched":0,"start":26906863,"end":26916108,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_FO_2.png","crunched":0,"start":26916108,"end":26925666,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_PC_1.png","crunched":0,"start":26925666,"end":26933336,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_PC_2.png","crunched":0,"start":26933336,"end":26940833,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_R_1.png","crunched":0,"start":26940833,"end":26952541,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_R_2.png","crunched":0,"start":26952541,"end":26965342,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_SK_1.png","crunched":0,"start":26965342,"end":26977226,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_SK_2.png","crunched":0,"start":26977226,"end":26988867,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_STP_1.png","crunched":0,"start":26988867,"end":26997305,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_STP_2.png","crunched":0,"start":26997305,"end":27005730,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_STS_1.png","crunched":0,"start":27005730,"end":27014891,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_STS_2.png","crunched":0,"start":27014891,"end":27024990,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_SV_1.png","crunched":0,"start":27024990,"end":27032868,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_SV_2.png","crunched":0,"start":27032868,"end":27041450,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_TBoI_1.png","crunched":0,"start":27041450,"end":27048887,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_TBoI_2.png","crunched":0,"start":27048887,"end":27056359,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_TW_1.png","crunched":0,"start":27056359,"end":27063926,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_TW_2.png","crunched":0,"start":27063926,"end":27071273,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_VS_1.png","crunched":0,"start":27071273,"end":27076265,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_VS_2.png","crunched":0,"start":27076265,"end":27084071,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_WF_1.png","crunched":0,"start":27084071,"end":27090701,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_WF_2.png","crunched":0,"start":27090701,"end":27098130,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_XR_1.png","crunched":0,"start":27098130,"end":27110276,"audio":false},{"filename":"/game.love/resources/textures/1x/collabs/collab_XR_2.png","crunched":0,"start":27110276,"end":27120896,"audio":false},{"filename":"/game.love/resources/textures/1x/gamepad_ui.png","crunched":0,"start":27120896,"end":27140823,"audio":false},{"filename":"/game.love/resources/textures/1x/icons.png","crunched":0,"start":27140823,"end":27149379,"audio":false},{"filename":"/game.love/resources/textures/1x/localthunk-logo.png","crunched":0,"start":27149379,"end":27159006,"audio":false},{"filename":"/game.love/resources/textures/1x/playstack-logo.png","crunched":0,"start":27159006,"end":27231732,"audio":false},{"filename":"/game.love/resources/textures/1x/stickers.png","crunched":0,"start":27231732,"end":27236116,"audio":false},{"filename":"/game.love/resources/textures/1x/tags.png","crunched":0,"start":27236116,"end":27243451,"audio":false},{"filename":"/game.love/resources/textures/1x/ui_assets.png","crunched":0,"start":27243451,"end":27244919,"audio":false},{"filename":"/game.love/resources/textures/1x/ui_assets_opt2.png","crunched":0,"start":27244919,"end":27246371,"audio":false},{"filename":"/game.love/resources/textures/2x/8BitDeck.png","crunched":0,"start":27246371,"end":27310769,"audio":false},{"filename":"/game.love/resources/textures/2x/8BitDeck_opt2.png","crunched":0,"start":27310769,"end":27391339,"audio":false},{"filename":"/game.love/resources/textures/2x/BlindChips.png","crunched":0,"start":27391339,"end":27525845,"audio":false},{"filename":"/game.love/resources/textures/2x/Enhancers.png","crunched":0,"start":27525845,"end":27619730,"audio":false},{"filename":"/game.love/resources/textures/2x/Jokers.png","crunched":0,"start":27619730,"end":28232254,"audio":false},{"filename":"/game.love/resources/textures/2x/ShopSignAnimation.png","crunched":0,"start":28232254,"end":28247909,"audio":false},{"filename":"/game.love/resources/textures/2x/Tarots.png","crunched":0,"start":28247909,"end":28367571,"audio":false},{"filename":"/game.love/resources/textures/2x/Vouchers.png","crunched":0,"start":28367571,"end":28452172,"audio":false},{"filename":"/game.love/resources/textures/2x/balatro.png","crunched":0,"start":28452172,"end":28487506,"audio":false},{"filename":"/game.love/resources/textures/2x/balatro_alt.png","crunched":0,"start":28487506,"end":28514574,"audio":false},{"filename":"/game.love/resources/textures/2x/boosters.png","crunched":0,"start":28514574,"end":28726237,"audio":false},{"filename":"/game.love/resources/textures/2x/chips.png","crunched":0,"start":28726237,"end":28736119,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_AC_1.png","crunched":0,"start":28736119,"end":28746024,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_AC_2.png","crunched":0,"start":28746024,"end":28755892,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_AU_1.png","crunched":0,"start":28755892,"end":28763866,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_AU_2.png","crunched":0,"start":28763866,"end":28774161,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_BUG_1.png","crunched":0,"start":28774161,"end":28787559,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_BUG_2.png","crunched":0,"start":28787559,"end":28802289,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_C7_1.png","crunched":0,"start":28802289,"end":28814009,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_C7_2.png","crunched":0,"start":28814009,"end":28825741,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_CL_1.png","crunched":0,"start":28825741,"end":28836234,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_CL_2.png","crunched":0,"start":28836234,"end":28846000,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_CR_1.png","crunched":0,"start":28846000,"end":28855851,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_CR_2.png","crunched":0,"start":28855851,"end":28866591,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_CYP_1.png","crunched":0,"start":28866591,"end":28878083,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_CYP_2.png","crunched":0,"start":28878083,"end":28889649,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_D2_1.png","crunched":0,"start":28889649,"end":28900155,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_D2_2.png","crunched":0,"start":28900155,"end":28910724,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_DBD_1.png","crunched":0,"start":28910724,"end":28920902,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_DBD_2.png","crunched":0,"start":28920902,"end":28931646,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_DS_1.png","crunched":0,"start":28931646,"end":28941270,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_DS_2.png","crunched":0,"start":28941270,"end":28950855,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_DTD_1.png","crunched":0,"start":28950855,"end":28960421,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_DTD_2.png","crunched":0,"start":28960421,"end":28967838,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_EG_1.png","crunched":0,"start":28967838,"end":28973679,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_EG_2.png","crunched":0,"start":28973679,"end":28980077,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_FO_1.png","crunched":0,"start":28980077,"end":28990999,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_FO_2.png","crunched":0,"start":28990999,"end":29002280,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_PC_1.png","crunched":0,"start":29002280,"end":29011367,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_PC_2.png","crunched":0,"start":29011367,"end":29020402,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_R_1.png","crunched":0,"start":29020402,"end":29034216,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_R_2.png","crunched":0,"start":29034216,"end":29049274,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_SK_1.png","crunched":0,"start":29049274,"end":29062998,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_SK_2.png","crunched":0,"start":29062998,"end":29076387,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_STP_1.png","crunched":0,"start":29076387,"end":29086429,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_STP_2.png","crunched":0,"start":29086429,"end":29096427,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_STS_1.png","crunched":0,"start":29096427,"end":29107486,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_STS_2.png","crunched":0,"start":29107486,"end":29119640,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_SV_1.png","crunched":0,"start":29119640,"end":29131253,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_SV_2.png","crunched":0,"start":29131253,"end":29143850,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_TBoI_1.png","crunched":0,"start":29143850,"end":29154574,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_TBoI_2.png","crunched":0,"start":29154574,"end":29165297,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_TW_1.png","crunched":0,"start":29165297,"end":29176524,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_TW_2.png","crunched":0,"start":29176524,"end":29187450,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_VS_1.png","crunched":0,"start":29187450,"end":29194869,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_VS_2.png","crunched":0,"start":29194869,"end":29204135,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_WF_1.png","crunched":0,"start":29204135,"end":29215418,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_WF_2.png","crunched":0,"start":29215418,"end":29228180,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_XR_1.png","crunched":0,"start":29228180,"end":29242409,"audio":false},{"filename":"/game.love/resources/textures/2x/collabs/collab_XR_2.png","crunched":0,"start":29242409,"end":29255301,"audio":false},{"filename":"/game.love/resources/textures/2x/gamepad_ui.png","crunched":0,"start":29255301,"end":29280166,"audio":false},{"filename":"/game.love/resources/textures/2x/icons.png","crunched":0,"start":29280166,"end":29291736,"audio":false},{"filename":"/game.love/resources/textures/2x/localthunk-logo.png","crunched":0,"start":29291736,"end":29312299,"audio":false},{"filename":"/game.love/resources/textures/2x/playstack-logo.png","crunched":0,"start":29312299,"end":29419687,"audio":false},{"filename":"/game.love/resources/textures/2x/stickers.png","crunched":0,"start":29419687,"end":29426425,"audio":false},{"filename":"/game.love/resources/textures/2x/tags.png","crunched":0,"start":29426425,"end":29437276,"audio":false},{"filename":"/game.love/resources/textures/2x/ui_assets.png","crunched":0,"start":29437276,"end":29439033,"audio":false},{"filename":"/game.love/resources/textures/2x/ui_assets_opt2.png","crunched":0,"start":29439033,"end":29440787,"audio":false},{"filename":"/game.love/tag.lua","crunched":0,"start":29440787,"end":29465926,"audio":false},{"filename":"/game.love/version.jkr","crunched":0,"start":29465926,"end":29465960,"audio":false},{"filename":"/game.love/web_compat.lua","crunched":0,"start":29465960,"end":29474199,"audio":false}]});

})();
