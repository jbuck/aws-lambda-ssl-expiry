const async = require('async');
const AWS = require('aws-sdk');
const cloudfront = new AWS.CloudFront();
const elbv1 = new AWS.ELB();
const elbv2 = new AWS.ELBv2();
const iam = new AWS.IAM();

exports.run = (event, context, callback) => {
  async.parallel({
    certificates: listCertificates,
    distributions: listDistributions,
    elbv1: listClassicLoadBalancers
  }, (err, results) => {
    if (err) {
      console.log(err);
    }

    printOutput(results.certificates, results.distributions, results.elbv1);
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
  var distributions = [];

  cloudfront.listDistributions().eachPage((err, data) => {
    if (err) {
      return list_callback(err);
    }

    if (data) {
      distributions = distributions.concat(data.DistributionList.Items);
      return;
    }

    var rv = {};
    distributions.filter((d) => {
      return !!d.ViewerCertificate.IAMCertificateId;
    }).forEach((d) => {
      if (!rv[d.ViewerCertificate.IAMCertificateId]) {
        rv[d.ViewerCertificate.IAMCertificateId] = [];
      }

      rv[d.ViewerCertificate.IAMCertificateId].push({
        id: d.Id,
        aliases: d.Aliases.Items,
      });
    });

    list_callback(null, rv);
  });
};

const listClassicLoadBalancers = (list_callback) => {
  var loadBalancers = [];

  elbv1.describeLoadBalancers().eachPage((err, data) => {
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
          name: lb.LoadBalancerName + ":" + ld.Listener.LoadBalancerPort
        });
      });
    });

    list_callback(null, rv);
  });
};

const twoWeeksFromNow = Date.now() + (14 * 24 * 60 * 60 * 1000);
const now = Date.now();
const verbose = true;

const printOutput = (certificates, distributions, elbv1) => {
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

    if (elbv1[c.Arn]) {
      elbv1[c.Arn].forEach((e) => {
        console.log("        Elastic Load Balancer %s", e.name);
      });
    }
  });
};
