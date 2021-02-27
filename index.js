const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter')
const humanizeDuration = require("humanize-duration")
const isoDuration = require("iso8601-duration")
const tempos_to_bpm = require('./tempos-to-bpm')
const get_sequence_links = require("./get-sequence-links")
const config = require('./config')
const util = require("./util")
const speech = config.speech


const UseWhileSequenceIsPlayingHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.context.AudioPlayer && handlerInput.requestEnvelope.context.AudioPlayer.token // if it has a token the audio is from this skill
        && (handlerInput.requestEnvelope.context.AudioPlayer.playerActivity == "PLAYING")
    },

    async handle(handlerInput) {
        console.log("Tried to use during sequence play - prompting")

        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
        if (!attributes.sequence_links) {
            console.log("Shouldn't happen: " + JSON.stringify(attributes))
            return handlerInput.responseBuilder().getResponse() // this shouldnt happen
        }

        let currentSequence = attributes.sequence_links[attributes.current_sequence]
        
        let speakOutput = speech.ALREADY_PLAYING_BEAT(currentSequence.bpm)

        return handlerInput.responseBuilder
        .speak(speakOutput)
        .withShouldEndSession(false)
        .getResponse()
    }
}

const NotApplicableIntents = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.LoopOffIntent' ||
            Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.LoopOnIntent' ||
            Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ShuffleOnIntent' ||
            Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ShuffleOffIntent' ||
            Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.RepeatIntent')
    },

    async handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak(speech.INTENT_NOT_APPLICABLE())
            .getResponse()
    }
}

const SilentHandleRequests = {
    canHandle(handlerInput) {
        let requestType = Alexa.getRequestType(handlerInput.requestEnvelope)
        return requestType == "AudioPlayer.PlaybackStopped" || requestType == "AudioPlayer.PlaybackStarted" || requestType == "System.ExceptionEncountered"
    },

    async handle(handlerInput) {
        return handlerInput.responseBuilder
            .getResponse()
    }
}


const StartOverIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StartOverIntent')
    },

    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

        if (!attributes.sequence_links) return LaunchRequestHandler.handle(handlerInput)

        attributes.current_sequence = 0

        attributes.sequence_links = resetSequenceLoops(attributes.sequence_links)

        handlerInput.attributesManager.setPersistentAttributes(attributes)
        await handlerInput.attributesManager.savePersistentAttributes()

        let currentSequence = attributes.sequence_links[attributes.current_sequence]

        

        return handlerInput.responseBuilder
        .speak(speech.STARTING_OVER(currentSequence.bpm))
        .addAudioPlayerPlayDirective('REPLACE_ALL', currentSequence.audioLink, currentSequence.bpm.toString() + "bpm", 0, undefined, {title: currentSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        .getResponse();
    }
}

const PreviousIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'PlaybackController.PreviousCommandIssued' ||
        (Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PreviousIntent')
    },

    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

        // no beat playing right now
        if (!attributes.sequence_links) {
            return handlerInput.responseBuilder
            .speak(speech.NOT_PLAYING_BEAT_RIGHT_NOW())
            .reprompt(speech.HELP_MESSAGE())
            .getResponse();
        }

        if (attributes.current_sequence == 0) {
            return handlerInput.responseBuilder
            .speak(speech.NO_PREV_SEQUENCE())
            .withShouldEndSession(true)
            .getResponse()
        }

        attributes.current_sequence--

        attributes.sequence_links = resetSequenceLoops(attributes.sequence_links)

        handlerInput.attributesManager.setPersistentAttributes(attributes)
        await handlerInput.attributesManager.savePersistentAttributes()

        let currentSequence = attributes.sequence_links[attributes.current_sequence]
        
        
        return handlerInput.responseBuilder
        .speak(speech.PREV_SEQUENCE(currentSequence.bpm))
        .addAudioPlayerPlayDirective('REPLACE_ALL', currentSequence.audioLink, currentSequence.bpm.toString() + "bpm", 0, undefined, {title: currentSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        .getResponse();
    }
}

const SpeedUpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'SpeedUpIntent')
    },

    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

         // no beat playing right now
         if (!attributes.sequence_links) {
            return handlerInput.responseBuilder
            .speak(speech.NOT_PLAYING_BEAT_RIGHT_NOW())
            .reprompt(speech.HELP_MESSAGE())
            .getResponse();
        }

        let currentSequence = attributes.sequence_links[attributes.current_sequence]

        let currentLoop = currentSequence.loop

        let shouldIncreaseBPMBy = config.increaseDecreaseBPMBy

        let bpm = handlerInput.requestEnvelope.request.intent.slots.bpm.value

        if (bpm) {
            bpm = parseInt(bpm)
            if (!isNaN(bpm)) shouldIncreaseBPMBy = bpm
        }

        currentSequence.bpm += shouldIncreaseBPMBy

        if (currentSequence.bpm > config.maxBPM) currentSequence.bpm = config.maxBPM
        if (currentSequence.bpm < config.minBPM) currentSequence.bpm = config.minBPM

        try {
            await sendProgressiveMessage(handlerInput, speech.INCREASING_BPM_TO(currentSequence.bpm))
        }
        catch (e) {
            console.error("Error while sending progressive message: " + e.stack)
        }

        // regenerate sequences with new BPM
        attributes.sequence_links = await get_sequence_links(attributes.sequence_links)
        
        currentSequence = attributes.sequence_links[attributes.current_sequence]
        // restore previous loop
        currentSequence.loop = currentLoop

        handlerInput.attributesManager.setPersistentAttributes(attributes)
        await handlerInput.attributesManager.savePersistentAttributes()

        
        
        
        return handlerInput.responseBuilder
        .addAudioPlayerPlayDirective('REPLACE_ALL', currentSequence.audioLink, currentSequence.bpm.toString() + "bpm", 0, undefined, {title: currentSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        .getResponse();
    }
}



const SlowDownIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'SlowDownIntent')
    },

    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

         // no beat playing right now
         if (!attributes.sequence_links) {
            return handlerInput.responseBuilder
            .speak(speech.NOT_PLAYING_BEAT_RIGHT_NOW())
            .reprompt(speech.HELP_MESSAGE())
            .getResponse();
        }

        let currentSequence = attributes.sequence_links[attributes.current_sequence]

        let currentLoop = currentSequence.loop

        let shouldDecreaseBPMBy = config.increaseDecreaseBPMBy

        let bpm = handlerInput.requestEnvelope.request.intent.slots.bpm.value

        if (bpm) {
            bpm = parseInt(bpm)
            if (!isNaN(bpm)) shouldDecreaseBPMBy = bpm
        }

        currentSequence.bpm -= shouldDecreaseBPMBy

        if (currentSequence.bpm > config.maxBPM) currentSequence.bpm = config.maxBPM
        if (currentSequence.bpm < config.minBPM) currentSequence.bpm = config.minBPM

        try {
            await sendProgressiveMessage(handlerInput, speech.DECREASING_BPM_TO(currentSequence.bpm))
        }
        catch (e) {
            console.error("Error while sending progressive message: " + e.stack)
        }

        // regenerate sequences with new BPM
        attributes.sequence_links = await get_sequence_links(attributes.sequence_links)
        
        currentSequence = attributes.sequence_links[attributes.current_sequence]
        // restore previous loop
        currentSequence.loop = currentLoop

        handlerInput.attributesManager.setPersistentAttributes(attributes)
        await handlerInput.attributesManager.savePersistentAttributes()

        
        
        
        return handlerInput.responseBuilder
        .addAudioPlayerPlayDirective('REPLACE_ALL', currentSequence.audioLink, currentSequence.bpm.toString() + "bpm", 0, undefined, {title: currentSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        .getResponse();
    }
}

const NextIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'PlaybackController.NextCommandIssued' ||
        (Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NextIntent')
    },

    async handle(handlerInput) {

        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

         // no beat playing right now
         if (!attributes.sequence_links) {
            return handlerInput.responseBuilder
            .speak(speech.NOT_PLAYING_BEAT_RIGHT_NOW())
            .reprompt(speech.HELP_MESSAGE())
            .getResponse();
        }

        console.log("Next: " + JSON.stringify(attributes))

        if (attributes.current_sequence >= attributes.sequence_links.length - 1) {
            return handlerInput.responseBuilder
            .speak(speech.NO_NEXT_SEQUENCE())
            .withShouldEndSession(true)
            .getResponse()
        }

        attributes.current_sequence++

        attributes.sequence_links = resetSequenceLoops(attributes.sequence_links)

        handlerInput.attributesManager.setPersistentAttributes(attributes)
        await handlerInput.attributesManager.savePersistentAttributes()

        let currentSequence = attributes.sequence_links[attributes.current_sequence]

        return handlerInput.responseBuilder
        .speak(speech.NEXT_SEQUENCE(currentSequence.bpm))
        .addAudioPlayerPlayDirective('REPLACE_ALL', currentSequence.audioLink, currentSequence.bpm.toString() + "bpm", 0, undefined, {title: currentSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        .getResponse();
    }
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        if (UseWhileSequenceIsPlayingHandler.canHandle(handlerInput)) return await UseWhileSequenceIsPlayingHandler.handle(handlerInput) // if sequence is already playing just go to this handler
        
        // check if we've purchased custom sequences
        await hasPurchasedCustomSequences(handlerInput)
        
        console.log("Launching")
        let speakOutput = speech.WELCOME_MESSAGE_QUICK()
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

        // If LaunchRequest was never used or last used over 3 days ago, add additional help message
        if (!attributes.lastUsed || (Date.now() - attributes.lastUsed) / 1000 > config.longWelcomeMessageExpiry) speakOutput = speech.WELCOME_MESSAGE_LONG();
        attributes.lastUsed = Date.now()
        handlerInput.attributesManager.setPersistentAttributes(attributes);
        await handlerInput.attributesManager.savePersistentAttributes();

        

        
        let response = handlerInput.responseBuilder
            .speak(speakOutput)
            .withSimpleCard(speech.WELCOME_MESSAGE_LONG())
            .reprompt(speech.HELP_MESSAGE())
            
        if (attributes.customSequences && attributes.customSequences.length > 0) {
            let dynamicEntities = util.generateDynamicEntitiesDirective(attributes.customSequences)
            response = response.addDirective(dynamicEntities)
        }
    
        return response.getResponse();
    }
};

const ConnectionsRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Connections.Response';
    },
    async handle(handlerInput) {
        await hasPurchasedCustomSequences(handlerInput)
        
        if (handlerInput.requestEnvelope.request.name != "Cancel") {
            let purchaseResult = handlerInput.requestEnvelope.request.payload.purchaseResult
            
            if (purchaseResult == "ACCEPTED" || purchaseResult == "ALREADY_PURCHASED") return CreateNewCustomSequenceIntent.handle(handlerInput)
            else if (purchaseResult == "DECLINED" || purchaseResult == "ERROR") return LaunchRequestHandler.handle(handlerInput)
        } else {
            return LaunchRequestHandler.handle(handlerInput)
        }
    }
};


function parseAlexaDurationToSeconds(duration) {
    if (duration == undefined) return -1
    return isoDuration.toSeconds(isoDuration.parse(duration))
}

const PlaySingleSequenceIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlaySingleSequenceIntent';
    },
    async handle(handlerInput) {
        let session = await handlerInput.attributesManager.getSessionAttributes()
        
        function exit(speech) {
            return handlerInput.responseBuilder
            .speak(speech)
            .reprompt(speech)
            .getResponse();
        }

       

        let bpm = handlerInput.requestEnvelope.request.intent.slots.bpm.value
        let duration = parseAlexaDurationToSeconds(handlerInput.requestEnvelope.request.intent.slots.duration.value)
        let tempo = handlerInput.requestEnvelope.request.intent.slots.tempo.value
        
        if (tempo) {
            let parsedTempo = tempos_to_bpm(tempo)
            if (!parsedTempo) return exit(speech.DONT_KNOW_TEMPO(tempo))

            bpm = parsedTempo
        }

        if (!bpm) {
            return exit(speech.PLEASE_CHOOSE_BPM())
        }

        bpm = parseInt(bpm)

        if (isNaN(bpm)) return exit(speech.DIDNT_UNDERSTAND())

        if (bpm < config.minBPM || bpm > config.maxBPM) return exit(speech.BPM_OUT_OF_RANGE(config.minBPM, config.maxBPM, bpm))

        if (duration != -1) {
            if (duration < config.minDuration || duration > config.maxDuration) {
                let niceMin = humanizeDuration(config.minDuration * 1000)
                let niceMax = humanizeDuration(config.maxDuration * 1000)
                let niceCurrent = humanizeDuration(duration * 1000)
                return exit(speech.DURATION_OUT_OF_RANGE(niceMin, niceMax, niceCurrent))
            }
        } else {
            if (session.creatingNewCustomSequence) return exit(speech.NO_DURATION_SPECIFIED())
        }

        if (!session.creatingNewCustomSequence) {
            try {
                let message 
                if (duration == -1) message = speech.PLAYING_A_BEAT_FOREVER(bpm)
                else {
                    let niceDuration = humanizeDuration(duration * 1000)
                    message = speech.PLAYING_A_BEAT(bpm, niceDuration)
                }
                await sendProgressiveMessage(handlerInput, message)
            }
            catch (e) {
                console.error("Error while sending progressive message: " + e.stack)
            }
    
            
            return PlaySequence(handlerInput, [{
                bpm: bpm,
                duration: duration
            }])
        } else {
            // we're in the midst of creating a custom sequence
            
            let customSeq = {
                duration: duration,
                bpm: bpm
            }
            
            session.creatingNewCustomSequence.push(customSeq)
            handlerInput.attributesManager.setSessionAttributes(session)
            
            if (session.creatingNewCustomSequence.length < config.maxCustomSequenceLength) {
                let thisPart = util.stringifyNumber(session.creatingNewCustomSequence.length)
                let nextPart = util.stringifyNumber(session.creatingNewCustomSequence.length + 1)
                let niceCurrent = humanizeDuration(duration * 1000)
                return exit(speech.OKAY_NEXT_PART(thisPart, nextPart, bpm, niceCurrent))
            } else {
                return FinishedIntentHandler.handle(handlerInput)
            }
        }
    }
};

const LogRequest = {
    async process(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
        //let session = handlerInput.attributesManager.getSessionAttributes()
        console.log(`Request type: ${Alexa.getRequestType(handlerInput.requestEnvelope)}, attributes: ${JSON.stringify(attributes)}`)
        console.log("REQUEST ENVELOPE = " + JSON.stringify(handlerInput.requestEnvelope));
        return
    }
}


async function PlaySequence(handlerInput, sequence) {
    let sequence_links = await get_sequence_links(sequence)
    let attributes = await handlerInput.attributesManager.getPersistentAttributes()
    attributes.sequence_links = sequence_links
    attributes.current_sequence = 0
    handlerInput.attributesManager.setPersistentAttributes(attributes);
    await handlerInput.attributesManager.savePersistentAttributes();

    return handlerInput.responseBuilder
        //.speak(speakOutput)
        .addAudioPlayerPlayDirective('REPLACE_ALL', sequence_links[0].audioLink, sequence_links[0].bpm.toString() + "bpm", 0, undefined, {title: sequence_links[0].bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
        .getResponse();
}

const PlaybackNearlyFinishedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'AudioPlayer.PlaybackNearlyFinished';
    },
    
    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
        
        if (!attributes.sequence_links) return handlerInput.responseBuilder.getResponse()

        let currentSequence = attributes.sequence_links[attributes.current_sequence]
        let nextSequence

        // a loop set to -1 means loop infinitely, so loop again
        if (currentSequence.loop == -1) {
            nextSequence = currentSequence
        }

        // loop is more than zero, so loop this same track again and reduce the loop amount
        if (currentSequence.loop > 0) {
            currentSequence.loop--
            nextSequence = currentSequence
        }

        // we've finished looping this track, move onto next or just stop enqueing
        if (currentSequence.loop == 0) {
            if (attributes.current_sequence < attributes.sequence_links.length - 1) {
                attributes.current_sequence++
                nextSequence = attributes.sequence_links[attributes.current_sequence]
            } else if (attributes.sequence_links.length > 1) {
                // if we have more than one sequence link, then we are playing a custom sequence - so loop back to the beginning again
                 attributes.sequence_links = resetSequenceLoops(attributes.sequence_links)
                 attributes.current_sequence = 0
                 nextSequence = attributes.sequence_links[attributes.current_sequence]
            }
        }

        console.log("Current sequence: " + JSON.stringify(currentSequence))
        console.log("Next sequence: " + JSON.stringify(nextSequence))

        handlerInput.attributesManager.setPersistentAttributes(attributes)
        await handlerInput.attributesManager.savePersistentAttributes()

        if (nextSequence == undefined) {
            // if we have no nextSequence, don't enqueue anything
            return handlerInput.responseBuilder.getResponse()
        }


        let response = handlerInput.responseBuilder
        .addAudioPlayerPlayDirective('ENQUEUE', nextSequence.audioLink, nextSequence.bpm.toString() + "bpm", 0, currentSequence.bpm.toString() + "bpm", {title: nextSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)

        return response.getResponse()
    }
};

const PlaybackFinished = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'AudioPlayer.PlaybackFinished';
    },
    
    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
        
        if (!attributes.sequence_links) return handlerInput.responseBuilder.getResponse()
        let currentSequence = attributes.sequence_links[attributes.current_sequence]

        // we've just finished the last loop of the last sequence
        if (currentSequence.loop == 0 && (attributes.current_sequence >= attributes.sequence_links.length - 1)) {
            delete attributes.sequence_links
            delete attributes.current_sequence
            handlerInput.attributesManager.setPersistentAttributes(attributes)
            await handlerInput.attributesManager.savePersistentAttributes()
        }

        return handlerInput.responseBuilder.getResponse()
    }
};

const ResumePlayback = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === "PlaybackController.PlayCommandIssued" || (Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.ResumeIntent'));
    },
    
    async handle(handlerInput) {
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

        if (!attributes.sequence_links) return LaunchRequestHandler.handle(handlerInput)

        let currentSequence = attributes.sequence_links[attributes.current_sequence]

        if (currentSequence == undefined) {
            return handlerInput.responseBuilder
            .speak(speech.NOT_PLAYING_BEAT_RIGHT_NOW())
            .reprompt(speech.HELP_MESSAGE())
            .getResponse();
        }

        return handlerInput.responseBuilder
        .speak(speech.RESUMING_BEAT(currentSequence.bpm))
        .addAudioPlayerPlayDirective('REPLACE_ALL', currentSequence.audioLink, currentSequence.bpm.toString() + "bpm", 0, undefined, {title: currentSequence.bpm + " BPM - Metronome Pro"})
        .withShouldEndSession(true)
        .getResponse();
    }
};

const PausePlayback = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === "PlaybackController.PauseCommandIssued" || (Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PauseIntent'));
    },
    async handle(handlerInput) {
        return handlerInput.responseBuilder
            .addAudioPlayerStopDirective()
            .withShouldEndSession(true)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    async handle(handlerInput) {
        if (UseWhileSequenceIsPlayingHandler.canHandle(handlerInput)) return await UseWhileSequenceIsPlayingHandler.handle(handlerInput) // if sequence is already playing just go to this handler

        const speakOutput = speech.HELP_MESSAGE();
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .withSimpleCard("Need a hand?", speech.HELP_MESSAGE())
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    async handle(handlerInput) {
        const speakOutput = speech.GOODBYE()
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};


const PlaybackFailedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'AudioPlayer.PlaybackFailed';
    },
    async handle(handlerInput) {
        console.log("FAILED PLAYBACK - trying again")
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()

        if (!attributes.sequence_links) return handlerInput.responseBuilder.getResponse()

        
        // just play the same track again
        return handlerInput.responseBuilder
            //.speak(speakOutput)
            .addAudioPlayerPlayDirective('REPLACE_ALL', attributes.sequence_links[attributes.current_sequence].audioLink, attributes.sequence_links[attributes.current_sequence].bpm.toString() + "bpm", 0, undefined, {title: attributes.sequence_links[attributes.current_sequence].bpm + " BPM - Metronome Pro"})
            .withShouldEndSession(true)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse();
    }
};

// PLAYING CUSTOM SEQUENCES

const PlayCustomSequenceIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'PlayCustomSequenceIntent' || Alexa.getIntentName(handlerInput.requestEnvelope) === 'WhatCanIBuyIntent')
    },

    async handle(handlerInput) {
        if ((await hasPurchasedCustomSequences(handlerInput)) == false) {
            return upsellCustomSequences(handlerInput)
        }
        
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
                    
        if (!attributes.customSequences || attributes.customSequences.length == 0) {
            return CreateNewCustomSequenceIntent.handle(handlerInput, true)
        }
        
        if (handlerInput.requestEnvelope.request.intent.slots) {
            let resolutions = util.separateResolutions(handlerInput.requestEnvelope.request.intent.slots.sequenceName)
            
            // we matched a dynamic authority for the customSequence slot, therefore the user has picked a sequence
            if (resolutions && resolutions.dynamic.length > 0) {
                let sequenceName = resolutions.dynamic[0].value.name
                
                let sequence = attributes.customSequences.filter((s) => s.name == sequenceName)
                
                if (sequence.length == 0) {
                    return handlerInput.responseBuilder.speak(speech.DONT_KNOW_SEQUENCE(sequenceName))
                    .withShouldEndSession(true)
                    .getResponse();
                }
                
                sequence = sequence[0].sequence
                
                let sequence_links = await get_sequence_links(sequence)
                attributes.sequence_links = sequence_links
                attributes.current_sequence = 0
                handlerInput.attributesManager.setPersistentAttributes(attributes);
                await handlerInput.attributesManager.savePersistentAttributes();
            
                return handlerInput.responseBuilder
                    .speak(speech.PLAYING_CUSTOM_SEQUENCE(sequenceName))
                    .addAudioPlayerPlayDirective('REPLACE_ALL', sequence_links[0].audioLink, sequence_links[0].bpm.toString() + "bpm", 0, undefined, {title: sequence_links[0].bpm + " BPM - Metronome Pro"})
                    .withShouldEndSession(true)
                    .getResponse();
            } 
        }
        
        
        let speechOutput = ""
        
        if (Alexa.getIntentName(handlerInput.requestEnvelope) === 'WhatCanIBuyIntent') speechOutput = speech.ALREADY_PURCHASED()
        else speechOutput = speech.CHOOSE_CUSTOM_SEQUENCE(attributes.customSequences.length)
        let response = handlerInput.responseBuilder
        .speak(speechOutput)
        .withShouldEndSession(false)
        
        
        if (attributes.customSequences && attributes.customSequences.length > 0) {
            let dynamicEntities = util.generateDynamicEntitiesDirective(attributes.customSequences)
            response = response.addDirective(dynamicEntities)
        }
        
        return response.getResponse();
    }
}

const DeleteCustomSequenceIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'DeleteSequenceIntent')
    },

    async handle(handlerInput) {
        if ((await hasPurchasedCustomSequences(handlerInput)) == false) {
            return upsellCustomSequences(handlerInput)
        }
        
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
                    
        
        let resolutions = util.separateResolutions(handlerInput.requestEnvelope.request.intent.slots.sequenceName)
        
        // we matched a dynamic authority for the customSequence slot, therefore the user has picked a sequence
        if (resolutions && resolutions.dynamic.length > 0) {
            let sequenceName = resolutions.dynamic[0].value.name
            
            let sequence = attributes.customSequences.filter((s) => s.name == sequenceName)
            
            if (sequence.length == 0) {
                return handlerInput.responseBuilder.speak(speech.DONT_KNOW_SEQUENCE(sequenceName))
                .withShouldEndSession(true)
                .getResponse();
            }
            
            attributes.customSequences = attributes.customSequences.filter((s) => s.name != sequenceName)
            handlerInput.attributesManager.setPersistentAttributes(attributes);
            await handlerInput.attributesManager.savePersistentAttributes();
        
            return handlerInput.responseBuilder
                .speak(speech.DELETED_CUSTOM_SEQUENCE(sequenceName))
                .withShouldEndSession(false)
                .getResponse();
        } else {
            let response = handlerInput.responseBuilder
            .speak(speech.DIDNT_UNDERSTAND())
            .withShouldEndSession(false)
        
        
            if (attributes.customSequences && attributes.customSequences.length > 0) {
                let dynamicEntities = util.generateDynamicEntitiesDirective(attributes.customSequences)
                response = response.addDirective(dynamicEntities)
            }
            
            return response.getResponse();
        }
        
    }
}


const ListCustomSequencesIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'ListCustomSequencesIntent')
    },

    async handle(handlerInput) {
        if ((await hasPurchasedCustomSequences(handlerInput)) == false) {
            return upsellCustomSequences(handlerInput)
        }
        
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
        if (!attributes.customSequences || attributes.customSequences.length == 0) {
            return CreateNewCustomSequenceIntent.handle(handlerInput, true)
        }
        

        
        let dynamicEntities = util.generateDynamicEntitiesDirective(attributes.customSequences)

        return handlerInput.responseBuilder
        .speak(speech.YOUR_SEQUENCES_ARE(attributes.customSequences))
        .addDirective(dynamicEntities)
        .withShouldEndSession(false)
        .getResponse();
    }
}



const CreateNewCustomSequenceIntent = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'CreateNewCustomSequenceIntent')
    },

    async handle(handlerInput, noExistingSequences) {
         if ((await hasPurchasedCustomSequences(handlerInput)) == false) {
            return upsellCustomSequences(handlerInput)
        }
        
        let session = await handlerInput.attributesManager.getSessionAttributes()
        
        session.creatingNewCustomSequence = []
        
        handlerInput.attributesManager.setSessionAttributes(session);
            
            
        let speechOutput = ""
        if (noExistingSequences) speechOutput = speech.NO_CUSTOM_SEQUENCES(config.maxCustomSequenceLength)
        else speechOutput = speech.CREATE_NEW_CUSTOM_SEQUENCE(config.maxCustomSequenceLength)
        
        return handlerInput.responseBuilder
        .speak(speechOutput)
        .reprompt(speech.CREATE_NEW_CUSTOM_SEQUENCE_REPROMPT())
        .withShouldEndSession(false)
        .getResponse();
    }
}

const RefundCustomSequencesIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'RefundCustomSequencesIntent')
    },

    async handle(handlerInput) {
        await hasPurchasedCustomSequences(handlerInput)
        let session = handlerInput.attributesManager.getSessionAttributes()
        
        return handlerInput.responseBuilder
        .addDirective({
            type: 'Connections.SendRequest',
            name: 'Cancel',
            payload: {
                InSkillProduct: {
                    productId: session.customSequencesProductId
                }
            },
            token: "correlationToken"
        })
        .getResponse();
    }
}


const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent')
    },

    async handle(handlerInput, noExistingSequences) {
        return handlerInput.responseBuilder
        .speak(speech.DIDNT_UNDERSTAND())
        .withShouldEndSession(false)
        .getResponse();
    }
}


 const FinishedIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'FinishedIntent')
    },

    async handle(handlerInput, noExistingSequences) {
        let session = await handlerInput.attributesManager.getSessionAttributes()
        
        if (!session.creatingNewCustomSequence) {
             return handlerInput.responseBuilder
                .speak(speech.NOT_CREATING_CUSTOM_SEQUENCE())
                .withShouldEndSession(false)
                .getResponse();
        }
        
        if (session.creatingNewCustomSequence.length == 0) {
            delete session.creatingNewCustomSequence
            handlerInput.attributesManager.setSessionAttributes(session)
            
            return handlerInput.responseBuilder
                .speak(speech.CANCELLED_CUSTOM_SEQUENCE())
                .withShouldEndSession(false)
                .getResponse();
        }
        
        session.customSequenceNeedsName = true
        handlerInput.attributesManager.setSessionAttributes(session);
            
        return handlerInput.responseBuilder
        .speak(speech.WHAT_SHOULD_I_CALL_SEQUENCE(session.creatingNewCustomSequence.length))
        .addDelegateDirective({
            name: 'NameCustomSequence',
            confirmationStatus: 'NONE',
            slots: {}
        })
        .withShouldEndSession(false)
        .getResponse();
    }
}

 const NameCustomSequenceIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'NameCustomSequence')
    },

    async handle(handlerInput, noExistingSequences) {
        let session = await handlerInput.attributesManager.getSessionAttributes()
        
        if (!session.creatingNewCustomSequence || !session.customSequenceNeedsName) {
             return handlerInput.responseBuilder
                .speak(speech.DIDNT_UNDERSTAND())
                .withShouldEndSession(false)
                .getResponse();
        }
        
        let name = handlerInput.requestEnvelope.request.intent.slots.customSequenceName.value
        
        let customSequence = {
            name: name,
            sequence: session.creatingNewCustomSequence
        }
        
        let attributes = await handlerInput.attributesManager.getPersistentAttributes()
        if (!attributes.customSequences) attributes.customSequences = []
        
        attributes.customSequences.push(customSequence)
        
        handlerInput.attributesManager.setPersistentAttributes(attributes)
        handlerInput.attributesManager.savePersistentAttributes(attributes)
        
        delete session.creatingNewCustomSequence
        delete session.customSequenceNeedsName
        
        handlerInput.attributesManager.setSessionAttributes(session)
        
        let dynamicEntities = util.generateDynamicEntitiesDirective(attributes.customSequences)
            
        return handlerInput.responseBuilder
        .speak(speech.SAVED_CUSTOM_SEQUENCE(name))
        .addDirective(dynamicEntities)
        .withShouldEndSession(false)
        .getResponse();
    }
}

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.stack}`);
        const speakOutput = `Sorry, I had trouble doing what you asked. Please try again.`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

function resetSequenceLoops(sequences) {
    sequences.forEach((sequence) => {
        sequence.loop = Math.ceil(sequence.duration/10)
    })

    return sequences
}

function upsellCustomSequences(handlerInput) {
    let session = handlerInput.attributesManager.getSessionAttributes()
    
    return handlerInput.responseBuilder.addDirective({
            type: "Connections.SendRequest",
            name: "Upsell",
            payload: {
                InSkillProduct: {
                    productId: session.customSequencesProductId,
                },
                upsellMessage: speech.CUSTOM_SEQUENCE_UPSELL(),
            },
            token: "correlationToken",
        }).getResponse()
}

async function hasPurchasedCustomSequences(handlerInput) {
    let session = handlerInput.attributesManager.getSessionAttributes()
    
    // we've already checked
    if (session.hasPurchasedCustomSequences === true) return true
    if (session.hasPurchasedCustomSequences === false) return false
    
    // not checked if purchased, check with Amazon
    
    const locale = handlerInput.requestEnvelope.request.locale
    let products = await handlerInput.serviceClientFactory.getMonetizationServiceClient().getInSkillProducts(locale)
    console.log(products)
    
    products = products.inSkillProducts
    
    let customSequences = products[0]
    
    let entitled = customSequences.entitled == "ENTITLED"
    session.hasPurchasedCustomSequences = entitled
    session.customSequencesProductId = customSequences.productId
    
    handlerInput.attributesManager.setSessionAttributes(session)
    return entitled
}

async function sendProgressiveMessage(handlerInput, speech) {
    // Call Alexa Directive Service.
    const requestEnvelope = handlerInput.requestEnvelope;
    const directiveServiceClient = handlerInput.serviceClientFactory.getDirectiveServiceClient();
  
    const requestId = requestEnvelope.request.requestId;
    const endpoint = requestEnvelope.context.System.apiEndpoint;
    const token = requestEnvelope.context.System.apiAccessToken;
  
    // build the progressive response directive
    const directive = {
      header: {
        requestId,
      },
      directive: {
        type: 'VoicePlayer.Speak',
        speech: speech,
      },
    };
  
    // send directive
    return directiveServiceClient.enqueue(directive, endpoint, token);
  }


// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({bucketName:process.env.S3_PERSISTENCE_BUCKET})
    )
    .addRequestHandlers(
        FallbackIntentHandler,
        ConnectionsRequestHandler,
        CreateNewCustomSequenceIntent,
        RefundCustomSequencesIntentHandler,
        DeleteCustomSequenceIntentHandler,
        PlayCustomSequenceIntentHandler,
        ListCustomSequencesIntentHandler,
        NameCustomSequenceIntentHandler,
        FinishedIntentHandler,
        SilentHandleRequests,
        NotApplicableIntents,
        LaunchRequestHandler,
        PlaybackFailedRequestHandler,
        StartOverIntentHandler,
        PlaybackFinished,
        ResumePlayback,
        PausePlayback,
        PlaySingleSequenceIntentHandler,
        PlaybackNearlyFinishedRequestHandler,
        PreviousIntentHandler,
        NextIntentHandler,
        HelpIntentHandler,
        SpeedUpIntentHandler,
        SlowDownIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
    )
    .addRequestInterceptors(LogRequest)
    .withApiClient(new Alexa.DefaultApiClient())
    .addErrorHandlers(
        ErrorHandler,
    )
    .lambda();
