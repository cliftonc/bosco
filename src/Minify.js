var _ = require('lodash');
var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var UglifyJS = require('uglify-js');
var sass = require('node-sass');
var CleanCSS = require('clean-css');
var async = require('async');

module.exports = function(bosco) {

  var createKey = require('./AssetHelper')(bosco).createKey;

  function minify(staticAssets, next) {

      // Create simple collections of css and js
      var jsAssets = {},
          cssAssets = {},
          otherAssets = {};

      _.map(staticAssets, function(asset, key) {
          if (asset.type === 'js') {
              if (!(asset.bundleKey in jsAssets)) jsAssets[asset.bundleKey] = {};
              jsAssets[asset.bundleKey][key] = asset.path;
          } else if (asset.type === 'css') {
              if (!(asset.bundleKey in cssAssets)) cssAssets[asset.bundleKey] = {};
              cssAssets[asset.bundleKey][key] = asset.path;
          } else {
              if (!(asset.bundleKey in otherAssets)) otherAssets[asset.bundleKey] = {};
              otherAssets[asset.bundleKey][key] = asset.path;
          }
      });

      _.assign(staticAssets, createManifest(staticAssets));

      async.series([
              function pcompileJs(next) {
                  compileJs(staticAssets, jsAssets, next);
              },
              function pcompileCss(next) {
                  compileCss(staticAssets, cssAssets, next);
              },
              function pcompileOthers(next) {
                  compileOthers(staticAssets, otherAssets, next);
              }
          ],
          function(err) {
              next(err, staticAssets);
          });

  }

  return {
      minify: minify
  }

  function createManifest(staticAssets) {
      var manifests = {};

      _.forOwn(staticAssets, function(value) {

          var manifestFile = createKey(value.serviceName, value.buildNumber, value.tag, value.type, 'manifest', 'txt');

          manifests[manifestFile] = manifests[manifestFile] || {
              content: '',
              serviceName: value.serviceName,
              buildNumber: value.buildNumber,
              type: 'plain',
              mimeType: 'text/plain',
              assetType: value.type,
              tag: value.tag,
              isMinifiedFragment: true,
              extname: '.manifest',
              files: []
          };

          var repoPath = value.repo || '';
          var basePath = value.basePath || '';
          var assetPath = value.asset || '';
          var relativePath = path.join(repoPath, basePath, assetPath);

          manifests[manifestFile].content += relativePath + ', Hash: ' + createHash(value.content) + ', Last commit: ' + value.commit;
          manifests[manifestFile].files.push({
              key: createKey(value.serviceName, value.buildNumber, relativePath, '', 'src', ''),
              relativePath: relativePath,
              content: value.content,
              path: value.path,
              type: value.type
          });
      });

      return manifests;
  }

  function compileJs(staticAssets, jsAssets, next) {

      _.forOwn(jsAssets, function(files, bundleKey) {

          if(files.length === 0) { return; }

          var compiled, serviceName, buildNumber, tag;

          bosco.log('Compiling ' + _.size(files) + ' ' + bundleKey.blue + ' JS assets ...');

          var uglifyConfig = bosco.config.get('js:uglify');

          for (var key in files) {
            if(!serviceName) {
              serviceName = staticAssets[key].serviceName;
              buildNumber = staticAssets[key].buildNumber;
              tag = staticAssets[key].tag;
            }
            delete staticAssets[key];
          }

          var uglifyOptions = {
            output: uglifyConfig ? uglifyConfig.outputOptions : null,
            compressor: uglifyConfig ? uglifyConfig.compressorOptions : null,
            mangle: uglifyConfig ? uglifyConfig.mangle : null,
                outSourceMap: tag + '.js.map',
                sourceMapIncludeSources: true
            };

          try {
            compiled = UglifyJS.minify(_.values(files), uglifyOptions);
          } catch (ex) {
              bosco.error('There was an error minifying files in ' + bundleKey.blue + ', error:');
              console.log(ex.message + '\n');
              compiled = {
                  code: ''
              };
          }

          var mapKey = createKey(serviceName, buildNumber, tag, 'js', 'js', 'map');
          staticAssets[mapKey] = staticAssets[mapKey] || {};
          staticAssets[mapKey].serviceName = serviceName;
          staticAssets[mapKey].buildNumber = buildNumber;
          staticAssets[mapKey].path = '';
          staticAssets[mapKey].path = '';
          staticAssets[mapKey].extname = '.map';
          staticAssets[mapKey].tag = tag;
          staticAssets[mapKey].type = 'js';
          staticAssets[mapKey].mimeType = 'application/javascript';
          staticAssets[mapKey].content = compiled.map;

          var hash = createHash(compiled.code);
          var minKey = createKey(serviceName, buildNumber, tag, hash, 'js', 'js');
          staticAssets[minKey] = staticAssets[minKey] || {};
          staticAssets[minKey].serviceName = serviceName;
          staticAssets[minKey].buildNumber = buildNumber;
          staticAssets[minKey].path = '';
          staticAssets[minKey].extname = '.js';
          staticAssets[minKey].tag = tag;
          staticAssets[minKey].type = 'js';
          staticAssets[minKey].hash = hash;
          staticAssets[minKey].mimeType = 'application/javascript';
          staticAssets[minKey].content = compiled.code;

      });

      next(null);

  }

  function compileCss(staticAssets, cssAssets, next) {

      var compiledCss = [];

      _.forOwn(cssAssets, function(files) {

          var compiled = {
              css: '',
              scss: '',
              count: 0
          };

          _.forOwn(files, function(file, key) {
              compiled.serviceName = staticAssets[key].serviceName;
              compiled.buildNumber = staticAssets[key].buildNumber;
              compiled.tag = staticAssets[key].tag;
              delete staticAssets[key];
              if (path.extname(file) == '.css') {
                  compiled.css += fs.readFileSync(file);
              } else if (path.extname(file) == '.scss') {
                  compiled.scss += fs.readFileSync(file);
              }
              compiled.count++;
          });

          compiledCss.push(compiled)

      });

      async.map(compiledCss, function(css, next) {

          bosco.log('Compiling ' + css.count + ' ' + css.tag.blue + ' CSS assets ...');

          sassRender({key: css.assetKey, content: css.scss}, function(err, code) {

            var cssContent = css.css + code.content, serviceName = css.serviceName, buildNumber = css.buildNumber;

            var cleanCssConfig = bosco.config.get('css:clean');

            if(cleanCssConfig && cleanCssConfig.enabled) {
              cssContent = new CleanCSS(cleanCssConfig.options).minify(cssContent);
            }

              if (err || cssContent.length === 0) return next({
                  message: 'No css for tag ' + css.tag
              });

              var hash = createHash(cssContent);
              var assetKey = createKey(serviceName, buildNumber, css.tag, hash, 'css', 'css');
              staticAssets[assetKey] = staticAssets[assetKey] || {};
              staticAssets[assetKey].serviceName = serviceName;
              staticAssets[assetKey].buildNumber = buildNumber;
              staticAssets[assetKey].path = '';
              staticAssets[assetKey].extname = '.css';
              staticAssets[assetKey].tag = css.tag;
              staticAssets[assetKey].type = 'css';
              staticAssets[assetKey].hash = hash + '.' + buildNumber;
              staticAssets[assetKey].mimeType = 'text/css';
              staticAssets[assetKey].content = cssContent;

              next();
          });

      }, function(err) {
          if (err) return bosco.warn('No CSS assets: ' + err.message);
          next(null);
      });

  }

   function compileOthers(staticAssets, otherAssets, next) {

      // For now do nothing
      next(null);

  }

  function createHash(code) {
      var hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 7);
      hash = hash.replace(/a/g,'b');
      hash = hash.replace(/e/g,'f');
      hash = hash.replace(/i/g,'j');
      hash = hash.replace(/o/g,'p');
      hash = hash.replace(/u/g,'v');
      return hash;
  }

  function  sassRender(scss, callback) {

      sass.render(scss.content, function(err, css) {
          if (err) return callback(err);
          return callback(null, {key: scss.key, content: css});
      });
  }
}
