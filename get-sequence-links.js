const config = require('./config')
const AWS = require('aws-sdk');
const s3 = new AWS.S3({
    credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
    },
    signatureVersion: 'v4'
})

// The URL to the generate metronome API
const generateAudioURL = config.generateAudioURL
const bucketName = config.s3Bucket //|| "test-bucket-jshxe"
const request = require("request-promise")


function getS3Key(bpm) {
    return "sequences/" + bpm + " BPM.wav"
}

// hits the metronome gen service and returns a buffer
async function generateAudio(bpm) {
    let requestOptions = {
        method: "POST",
        uri: generateAudioURL,
        json: true,
        headers: {
            'Accept': 'audio/wav',
        },
        encoding: null,
        body: [{bpm: bpm, duration: 10}]
    }

    let data = new Buffer(await request(requestOptions))
    //console.log(`Generated sequence [${convertToGUID(sequences)}] - ${data.byteLength} bytes`)
    return data
}

async function getCachedAudio(bpm) {
    // check if the audio already exists in S3 using the GUID
    try {
        let params = {
            Bucket: bucketName,
            Key: getS3Key(bpm)
        }

        // this will throw if it doesn't exist
        await s3.headObject(params).promise()
        const signedUrl = s3.getSignedUrl('getObject', params)

        console.log("Found in cache, returning URL " + signedUrl)
        return signedUrl
    } catch (e) {
        if (e.code != "NotFound") throw e
    }

    return null
}

async function getAudioLink(bpm) {
    let cachedLink = await getCachedAudio(bpm)

    if (cachedLink) {
        console.log(`Found ${bpm} in cache, returning: ${cachedLink}`)
        return cachedLink
    }

    console.log(`Generating sequence for ${bpm}...`)
    // generate and download audio
    let data = await generateAudio(bpm)

    console.log(`Uploading sequence to S3...`)

    let uploadParams = {
        Bucket: bucketName,
        Key: getS3Key(bpm),
        Body: data
    }
    
    let uploadResult = await s3.upload(uploadParams).promise()

    let presignedURL = s3.getSignedUrl('getObject', {
        Bucket: bucketName,
        Key: uploadResult.Key,
        Expires: 60*60*2 // access expires after 2 hours
    })

    console.log("Uploaded with URL " + presignedURL)
    return presignedURL
}

module.exports = async (sequences) => {
    let sequencePromises = []

    sequences.forEach((sequence) => {
        sequencePromises.push(new Promise(async (resolve, reject) => {
            console.log(`Getting link for BPM ${sequence.bpm}, duration ${sequence.duration}`)

            let audioLink = await getAudioLink(sequence.bpm)

            resolve({
                duration: sequence.duration,
                audioLink: audioLink,
                loop: sequence.duration == -1? -1 : Math.ceil(sequence.duration/10), // if duration is -1 (indefinitely) set loop to -1 too
                bpm: sequence.bpm
            })
        }))
    })

    let resolvedSequences = await Promise.all(sequencePromises)

    return resolvedSequences
}

/*
let sequences = [{
    bpm: 100,
    duration: 40
},
{
    bpm: 80,
    duration: 20
}]

module.exports(sequences).then(console.log).catch(console.error)*/
