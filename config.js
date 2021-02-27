const util = require("./util")

module.exports = {
    // Endpoint to hit for generating metronome audio
    generateAudioURL: 'INSERT AUDIO GEN ENDPOINT HERE',

    // S3 bucket name to use to store audio
    s3Bucket: "INSERT S3 BUCKET NAME HERE",
    
    // Access key pair for IAM user for the S3 bucket
    accessKeyId: "INSERT IAM ACCESS KEY HERE",
    secretAccessKey: "INSERT IAM SECRET HERE",

    // How long before bringing back the reminder welcome message (in seconds)
    longWelcomeMessageExpiry: 60*60*24 *3, // 3 days,

    // minimum and maximum BPM for a track
    minBPM: 20,
    maxBPM: 200,

    minDuration: 10, //10 seconds
    maxDuration: 60 * 30, // 30 minutes

    // how much to increase or decrease BPM by when user says "speed up" without specifying how much by
    increaseDecreaseBPMBy: 10,
    
    maxCustomSequenceLength: 5,

    speech: {
        WELCOME_MESSAGE_QUICK: () =>                            'Welcome back. What BPM beat should I play at, or do you want to play a custom sequence?',
        WELCOME_MESSAGE_LONG: () =>                             "Welcome to Metronome Pro! You can say, play a beat at 80bpm for 30 seconds, or, play a beat at Andante or, play a custom sequence",
        HELP_MESSAGE: () =>                                     "You can say, play a beat at 80bpm for 30 seconds, or, play a beat at Andante or, play a custom sequence",
        ALREADY_PLAYING_BEAT: (bpm) =>                          `I'm playing a ${bpm} BPM beat right now. You can say speed up, slow down, or choose another BPM to play at`,
        DONT_KNOW_TEMPO: (tempo) =>                             `I don't know the tempo ${tempo}, please try again`,
        PLEASE_CHOOSE_BPM: () =>                                "Please choose a BPM!",
        DIDNT_UNDERSTAND: () =>                                 "I didn't understand that, please try again.",
        BPM_OUT_OF_RANGE: (min, max, current) =>                `The BPM needs to be between ${min} and ${max}, you said ${current} BPM.`,
        DURATION_OUT_OF_RANGE: (min, max, current) =>           `The duration needs to be between ${min} and ${max}, you said ${current}.`,
        PLAYING_A_BEAT_FOREVER: (bpm) =>                        `Playing a beat at ${bpm} BPM`,
        PLAYING_A_BEAT: (bpm, duration) =>                      `Playing a beat at ${bpm} BPM for ${duration}`,
        NOT_PLAYING_BEAT_RIGHT_NOW: () =>                       "I'm not playing a beat right now. What BPM should I play?",
        RESUMING_BEAT: (bpm) =>                                 `Resuming beat at ${bpm} BPM`,
        GOODBYE: () =>                                          "Goodbye!",
        INTENT_NOT_APPLICABLE: () =>                            "You can't do that with a metronome.",
        STARTING_OVER: (bpm) =>                                 `Starting over from the beginning at ${bpm} BPM`,
        NO_PREV_SEQUENCE: () =>                                 `There isn't a sequence before this one.`,
        NO_NEXT_SEQUENCE: () =>                                 `There isn't a sequence after this one.`,
        PREV_SEQUENCE: (bpm) =>                                 `Going back to the beat at ${bpm} BPM`,
        NEXT_SEQUENCE: (bpm) =>                                 `Going to the next beat at ${bpm} BPM`,
        INCREASING_BPM_TO: (bpm) =>                             `Speeding up to ${bpm} BPM`,
        DECREASING_BPM_TO: (bpm) =>                             `Slowing down to ${bpm} BPM`,
        CHOOSE_CUSTOM_SEQUENCE: (sequenceCount) =>              `You have ${sequenceCount} custom sequence${sequenceCount > 1?'s':''}. Choose which one to play, or create a new one.`,
        YOUR_SEQUENCES_ARE: (sequences) =>                      `You have ${sequences.length} sequence${sequences.length > 1?'s':''}: ${util.niceListSequences(sequences, 'and')}`,
        NO_CUSTOM_SEQUENCES: (max) =>                           `You don't have any custom sequences, let's make one. It can have up to ${max} parts, and each part has a different BPM and plays for a certain amount of seconds. When you're ready, tell me the BPM and duration for the first part.`,
        CREATE_NEW_CUSTOM_SEQUENCE: (max) =>                    `Let's make a new sequence. It can have up to ${max} parts, and each part has a different BPM and plays for a certain amount of seconds. When you're ready, tell me the BPM and duration for the first part.`,
        CREATE_NEW_CUSTOM_SEQUENCE_REPROMPT: () =>              `For example, say '40 bpm for 20 seconds`,
        PLAYING_CUSTOM_SEQUENCE: (sequenceName) =>              `Playing custom sequence ${sequenceName}`,
        DONT_KNOW_SEQUENCE: (sequenceName) =>                   `I don't have the custom sequence ${sequenceName}`,
        NO_DURATION_SPECIFIED: () =>                            `Please specify a duration.`,
        OKAY_NEXT_PART: (thisPart, nextPart, bpm, duration) =>  `Okay, the ${thisPart} part is ${bpm} bpm for ${duration}. Now tell me the ${nextPart} part or say 'I'm finished'`,
        NOT_CREATING_CUSTOM_SEQUENCE: () =>                     `You're not making a custom sequence right now.`,
        CANCELLED_CUSTOM_SEQUENCE: () =>                        `Okay, I didn't save anything.`,
        WHAT_SHOULD_I_CALL_SEQUENCE: (partAmounts) =>           `Okay, what should I call this ${partAmounts}-part sequence? For example, say: 'I want to call it Guitar Practice'`,
        PLEASE_CHOOSE_NAME: () =>                               `Please choose a name.`,
        SAVED_CUSTOM_SEQUENCE: (name) =>                        `Right, I've saved your sequence ${name}. You can play it by saying 'Play the custom sequence ${name}' and you can see what you've got by asking me 'what custom sequences do I have'.`,
        DELETED_CUSTOM_SEQUENCE: (name) =>                      `Okay, I deleted the custom sequence ${name}`,
        CUSTOM_SEQUENCE_UPSELL: () =>                           `Custom Sequences let you create, save, and play sets of beats from your Alexa device. Wanna know more?`,
        ALREADY_PURCHASED: () =>                                 `You've already got Custom Sequences. Choose one to play, or create a new one.`,
    }
}