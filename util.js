const AWS = require('aws-sdk');

const s3SigV4Client = new AWS.S3({
    signatureVersion: 'v4'
});

var special = ['zeroth','first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
var deca = ['twent', 'thirt', 'fort', 'fift', 'sixt', 'sevent', 'eight', 'ninet'];


module.exports = {
    stringifyNumber: function (n) {
          if (n < 20) return special[n];
          if (n%10 === 0) return deca[Math.floor(n/10)-2] + 'ieth';
          return deca[Math.floor(n/10)-2] + 'y-' + special[n%10];
    },
    
    // parses the custom sequences and returns a Dynamic Entities directive for them
    generateDynamicEntitiesDirective: function(customSequences) {
        let i = 0

        let values = customSequences.map((customSequence) => {
            i++
            return {
                id: "sequenceName" + i,
                name: {
                    value: customSequence.name,
                    synonyms: []
                }
            }
        })

        return {
            type: "Dialog.UpdateDynamicEntities",
            updateBehavior: "REPLACE",
            types: [
              {
                name: "sequenceName",
                values: values
              }
            ]
          };
    },

    // seperates out the resolutions by authority to static and dynamic (from https://www.talkingtocomputers.com/dynamic-entities-alexa-skills-kit)
    separateResolutions: function(slot) {
        if (!slot.resolutions) return null
        
        let resolutions = slot.resolutions.resolutionsPerAuthority
        const dynamicMatcher = /echo-sdk\.dynamic\.amzn1/;
        const reducer = function (acc, curr) {
        if (curr.authority.match(dynamicMatcher)) {
            acc.dynamic = curr.values;
        } else {
            acc.static = curr.values;
        }
    
        return acc;
        };
    
        return resolutions.reduce(reducer, {dynamic: [], static: []});
    },

    getS3PreSignedUrl: function (s3ObjectKey) {
        const bucketName = process.env.S3_PERSISTENCE_BUCKET;
        const s3PreSignedUrl = s3SigV4Client.getSignedUrl('getObject', {
            Bucket: bucketName,
            Key: s3ObjectKey,
            Expires: 60*1 // the Expires is capped for 1 minute
        });
        console.log(`Util.s3PreSignedUrl: ${s3ObjectKey} URL ${s3PreSignedUrl}`);
        return s3PreSignedUrl;
    },
    
    niceListSequences: function (sequences, connectorWord) {
        if (sequences.length == 1) return sequences[0].name
        
        let firstPart = sequences.slice(0, sequences.length - 1).map(s => s.name).join(', ')
        firstPart += ` ${connectorWord} ${sequences[sequences.length - 1].name}`
        
        return firstPart
    },
}
