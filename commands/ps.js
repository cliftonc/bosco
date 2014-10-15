
var async = require('async');
var Table = require('cli-table');
var NodeRunner = require('../src/RunWrappers/Node');
var DockerRunner = require('../src/RunWrappers/Docker');
var nodeList = [];
var dockerList = [];

module.exports = {
    name:'ps',
    description:'Lists all running services',
    example:'bosco ps',
    cmd:cmd
}

function cmd(bosco) {

    var initialiseRunners = function(next) {
        var runners = [NodeRunner, DockerRunner];
        async.map(runners, function loadRunner(runner, cb) {
            runner.init(bosco, cb);
        }, next);
    }

    var getRunningServices = function(next) {
        NodeRunner.listRunning(true, function(err, nodeRunning) {
            if (err) return next(err);
            nodeList = nodeRunning;
            DockerRunner.list(true, function(err, dockerRunning) {
                if (err) return next(err);
                dockerList = dockerRunning;
                next();
            })
        })
    }

    var printNodeServices = function(name, list) {

        var table = new Table({
            head: [name + ' Service', 'PID', 'Status', 'Mode', 'Watch'], colWidths: [60,10,10,12,10]
        });

        list.forEach(function(item) {
            table.push([item.name, item.pid, item.pm2_env.status, item.pm2_env.exec_mode, item.pm2_env.watch || '']);
        });

        console.log(table.toString());
        console.log('\r');

    }

    var printDockerServices = function(name, list) {

        var table = new Table({
            head: [name + ' Service', 'Status','ID'], colWidths: [60,20,20]
        });

        list.forEach(function(item) {
            table.push([item.Image, item.Status, item.Id.substr(0,12)]);
        });

        console.log(table.toString());
        console.log('\r');

    }

    bosco.log('Getting running mircoservices ...');

    async.series([initialiseRunners, getRunningServices], function() {

        console.log('');
        bosco.log('Running NodeJS Services (via PM2):');
        printNodeServices('Node', nodeList);

        bosco.log('Running Docker Images:');
        printDockerServices('Docker', dockerList);

        process.exit(0);
    })

}

