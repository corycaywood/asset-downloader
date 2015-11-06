var http = require('http'),
	fs = require('fs'),
	path = require('path'),
	url = require('url'),
	express = require("express"),
	app = express(),
	bodyParser =  require("body-parser"),
	events = require('events'),
	eventEmitter = new events.EventEmitter(),
	archiver = require('archiver'),
	mkdirp = require('mkdirp'),
	rimraf = require( 'rimraf'),
	PORT = "1337",
	DOWNLOAD_FOLDER_BASE = "resources_",
	FONT_DIRECTORY = "fonts",
	IMAGE_DIRECTORY = "images",
	ZIP_DIRECTORY = "zip",
	REGEX = /url\([^\)]*?(\.jpg|\.png|\.gif|\.eot|\.woff|\.woff2|\.svg|\.otf|\.ttf)\s?'?\s?\)/ig;

function downloadFromCssFile(URL_STRING, folder){
	var BASE_URL = url.parse(URL_STRING).host,
		FILE_PATH = url.parse(URL_STRING).path,
		PATH = path.dirname(FILE_PATH) + "/",
		CSS_FILE = path.basename(FILE_PATH),
		cssOptions = {
			host: BASE_URL,
			port: 80,
			path: FILE_PATH
		};
		
	//Make directories
	mkdirp(path.join(__dirname, folder, FONT_DIRECTORY), function(err) {});
	mkdirp(path.join(__dirname, folder, IMAGE_DIRECTORY), function(err) {});
	mkdirp(path.join(__dirname, ZIP_DIRECTORY), function(err) {});
	
	http.get(cssOptions, function(res){
		var cssdata = '';
		res.setEncoding('binary');
	
		//On Data
		res.on('data', function(chunk){
			cssdata += chunk;
		})
	
		//On End
		res.on('end', function(){
			var resources = cssdata.match(REGEX);
			if (resources == null) {
				eventEmitter.emit('noResources' + folder);
			} else {
				downloadResource(resources.length - 1);
			}
			
			//Download Resource function
			function downloadResource(count){
				var resource = resources[count].replace(/url\((.*?)\)/g, '$1').replace(/\'/g, "").replace(/\"/g, "").replace(/\s/g, ""),
					host = url.parse(resource).host != null ? url.parse(resource).host : BASE_URL,
					_path = resource.match(/^\//) != null || url.parse(resource).protocol != null ? "" : PATH;
				var options = {
					host: host,
					port: 80,
					path: _path + resource
				}
				
				console.log(host + _path + resource);
	
				//HTTP request
				http.get(options, function(res){
					var resourcedata = '',
						resourceName = path.basename(resource);
					res.setEncoding('binary');
	
					//On Data
					res.on('data', function(chunk){
						resourcedata += chunk;
					})
	
					//On End
					res.on('end', function(){
						//Save to correct folder
						var extName = path.extname(resourceName),
							resourceFolder = (extName == '.jpg' || extName == '.gif' || extName == '.png') ? IMAGE_DIRECTORY : FONT_DIRECTORY; 
						//Write file
						fs.writeFile(path.join(folder, resourceFolder, resourceName), resourcedata, 'binary', function(err){
							if (err) throw err
							console.log('File saved: ' + host + _path + resource);
							//Recursively download - so it will download one at a time
							if (count > 0) {
								downloadResource(count - 1)
							} else {
								eventEmitter.emit('doneDownloading' + folder);
							}
						})
					})
	
				})
			}
		})
	});
}

//Save Zip File
function saveZip(folder){
	var archive = archiver.create('zip', {});
	var output = fs.createWriteStream(path.join(ZIP_DIRECTORY, folder + '.zip'));
	archive.directory(folder, '');
	archive.pipe(output);
	output.on('finish', function(){
		eventEmitter.emit('doneZipping' + folder);
	})
	archive.finalize();
}

//Server 
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

//Get Resources
app.post('/getResourcesFromUrl', function(req,res){
	var stylesheetUrl = req.body.stylesheetUrl,
		folderName = DOWNLOAD_FOLDER_BASE + Date.now();
	//Fix stylesheet URL if missing protocol
	stylesheetUrl = (url.parse(stylesheetUrl).protocol == null) ? "http://" + stylesheetUrl : stylesheetUrl;
	//Error if not valid URL
	if (path.extname(stylesheetUrl) != ".css") {
		res.status(500).send({ error: 'Invalid URL.' });
	} else {
		//Download resources
		downloadFromCssFile(stylesheetUrl, folderName);
	}
	
	//Zip resources when finished
	eventEmitter.on('doneDownloading' + folderName, function(){
		saveZip(folderName);
	});
	
	eventEmitter.on('doneZipping' + folderName, function(){
		//Send Success
		var response = {
			status  : 200,
			success : 'Updated Successfully',
			zipFile : folderName + ".zip"
		}
		res.end(JSON.stringify(response));
		//Delete resource directory
		rimraf.sync(path.join(__dirname, folderName));
	});
	
	//Error if no resources to download
	eventEmitter.on('noResources' + folderName, function(){
		res.status(500).send({ error: 'No resources to download.' });
	});
});

//Return Zip File
app.get('/getZipFile/:fileName.zip',function(request,response, next){
	var rs = fs.createReadStream(path.resolve(__dirname, ZIP_DIRECTORY, request.params.fileName + '.zip'));
	rs.on('error', function (error) {
		var err = new Error();
		err.status = 404;
		next(err);
	});
	rs.on('open', function () {
		var ct = "application/zip";
		response.writeHead(200, { "Content-Type" : ct });
		rs.pipe(response);
	});
});

// handling 404 errors
app.use(function(err, req, res, next) {
	if(err.status !== 404) {
	return next();
	}
	res.send(err.message || 'Not found');
});

//Start Server
app.listen(PORT,function(){
  console.log("Started on PORT " + PORT);
}) 