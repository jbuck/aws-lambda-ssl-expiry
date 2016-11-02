const async = require('async');
const AWS = require('aws-sdk');
const cloudfront = new AWS.CloudFront();
const iam = new AWS.IAM();

exports.run = (event, context, callback) => {
  async.parallel({
    certificates: listCertificates,
    distributions: listDistributions,
    elb: listClassicLoadBalancers
  }, (err, results) => {
    if (err) {
      console.log(err);
    }

    printOutput(results.certificates, results.distributions, results.elb);
  });
};

const listCertificates = (list_callback) => {
  var certs = [];

  iam.listServerCertificates().eachPage((err, data) => {
    if (err) {
      return list_callback(err);
    }

    if (data) {
      certs = certs.concat(data.ServerCertificateMetadataList);
      return;
    }

    certs.sort((a, b) => {
      return a.Expiration - b.Expiration;
    });

    list_callback(null, certs);
  });
};

const listDistributions = (list_callback) => {
  var distributions = {};

  cloudfront.listDistributions().eachPage((err, data) => {
    if (err) {
      return list_callback(err);
    }

    if (!data) {
      return list_callback(null, distributions);
    }

    data.DistributionList.Items.filter((d) => {
      return !!d.ViewerCertificate.IAMCertificateId;
    }).forEach((d) => {
      if (!distributions[d.ViewerCertificate.IAMCertificateId]) {
        distributions[d.ViewerCertificate.IAMCertificateId] = [];
      }

      distributions[d.ViewerCertificate.IAMCertificateId].push({
        id: d.Id,
        aliases: d.Aliases.Items,
      });
    });
  });
};

const lbRegions = [
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "eu-central-1",
  "eu-west-1",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2"
];

const listClassicLoadBalancers = (list_callback) => {
  var rv = {};

  async.eachLimit(lbRegions, 2, (region, region_callback) => {
    const elb = new AWS.ELB({ region: region });

    _listClassicLoadBalancers(elb, (elb_error, data) => {
      Object.keys(data).forEach((d) => {
        if (!rv[d]) {
          rv[d] = [];
        }

        rv[d] = rv[d].concat(data[d]);
      });

      region_callback(elb_error);
    });
  }, (region_error) => {
    list_callback(region_error, rv);
  });
};

const _listClassicLoadBalancers = (elb, list_callback) => {
  var loadBalancers = [];

  elb.describeLoadBalancers().eachPage((err, data) => {
    if (err) {
      return list_callback(err);
    }

    if (data) {
      loadBalancers = loadBalancers.concat(data.LoadBalancerDescriptions);
      return;
    }

    var rv = {};
    loadBalancers.filter((lb) => {
      return lb.ListenerDescriptions.some((ld) => {
        return !!ld.Listener.SSLCertificateId;
      });
    }).forEach((lb) => {
      lb.ListenerDescriptions.forEach((ld) => {
        if (!ld.Listener.SSLCertificateId) {
          return;
        }

        if (!rv[ld.Listener.SSLCertificateId]) {
          rv[ld.Listener.SSLCertificateId] = [];
        }

        rv[ld.Listener.SSLCertificateId].push({
          name: elb.config.region + ":" + lb.LoadBalancerName + ":" + ld.Listener.LoadBalancerPort
        });
      });
    });

    list_callback(null, rv);
  });
};

const twoWeeksFromNow = Date.now() + (14 * 24 * 60 * 60 * 1000);
const now = Date.now();
const verbose = true;

const printOutput = (certificates, distributions, elb) => {
  certificates.forEach((c) => {
    if (c.Expiration < now) {
      console.log("EXPIRED %s on %s", c.Arn, c.Expiration.toISOString());
    } else if (c.Expiration < twoWeeksFromNow) {
      console.log("WARNING %s on %s", c.Arn, c.Expiration.toISOString());
    } else if (verbose) {
      console.log("OKAY    %s on %s", c.Arn, c.Expiration.toISOString());
    } else {
      return;
    }

    if (distributions[c.ServerCertificateId]) {
      distributions[c.ServerCertificateId].forEach((d) => {
        console.log("        Cloudfront distribution %s aka %s", d.id, d.aliases.join(", "));
      });
    }

    if (elb[c.Arn]) {
      elb[c.Arn].forEach((e) => {
        console.log("        Elastic Load Balancer %s", e.name);
      });
    }
  });
};
