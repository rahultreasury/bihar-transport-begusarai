/**
 * useVoiceSearch.js
 *
 * Free, browser-native voice input for the booking location fields using the
 * Web Speech API. No paid/hosted speech service, no backend call, no API cost.
 *
 *   const { start, stop, toggle, listeningField, message, clearMessage, supported }
 *     = useVoiceSearch({ onResult });
 *
 * DESIGN NOTE — this hook ONLY produces text.
 * It deliberately never sets a confirmed location, never picks an autocomplete
 * suggestion, and never submits. The transcript is handed back to the caller,
 * which drops it into the existing location input so the *existing* Google
 * Places autocomplete runs exactly as it does for typing, and the customer
 * still has to choose a suggestion. That keeps "search text" and "confirmed
 * location" as separate states, which is what route calculation depends on.
 *
 * Browser support: Chrome, Edge, Safari 14.1+ and other Chromium/WebKit
 * browsers. `isSupported` is false elsewhere and callers should hide the mic
 * rather than let the user hit a dead button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Recognition language. 'en-IN' handles English, Hindi and Hinglish input well
 * in Indian locales; change this one constant to switch the whole feature.
 * Other useful values: 'hi-IN' (Hindi), 'en-US', 'en-GB', 'mr-IN', 'bn-IN'.
 */
export const VOICE_LANGUAGE = 'en-IN';

const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export default function useVoiceSearch({ onResult, language = VOICE_LANGUAGE } = {}) {
  const recognitionRef = useRef(null);
  // Final transcript is what counts; interim text is display-only and is never
  // written into the field (see onResult contract below).
  const [listeningField, setListeningField] = useState(null);
  const [interimText, setInterimText] = useState('');
  const [message, setMessage] = useState('');
  // Which field the current message belongs to, so a single shared string is
  // not painted under every location input on the page.
  const [messageField, setMessageField] = useState(null);

  const supported = typeof window !== 'undefined' && !!getSpeechRecognition();

  // Teardown helper — always stops the engine and clears the listening UI so we
  // can never be left showing a pulsing mic after the session has ended.
  const teardown = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.stop();
      } catch {
        /* engine may already be stopped — nothing to recover from */
      }
    }
    recognitionRef.current = null;
    setListeningField(null);
    setInterimText('');
  }, []);

  const stop = useCallback(() => {
    teardown();
    setMessage('');
    setMessageField(null);
  }, [teardown]);

  /** Attach a message to one specific field (null clears it). */
  const setFieldMessage = useCallback((field, text) => {
    setMessage(text);
    setMessageField(text ? field : null);
  }, []);

  const start = useCallback(
    (field) => {
      const SpeechRecognition = getSpeechRecognition();
      if (!SpeechRecognition) {
        setFieldMessage(field, "Voice search isn't supported in this browser. Please type the location.");
        return;
      }
      if (!field) return;

      // Tapping the mic on the other field, or on an already-listening field,
      // stops first — this keeps a single live recognition instance.
      if (listeningField && listeningField !== field) {
        teardown();
      }
      if (listeningField === field) {
        teardown();
        setFieldMessage(null, '');
        return;
      }

      setFieldMessage(null, '');

      let recognition;
      try {
        recognition = new SpeechRecognition();
      } catch {
        setFieldMessage(field, "Voice search isn't supported in this browser. Please type the location.");
        return;
      }

      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setListeningField(field);
        setInterimText('');
        setFieldMessage(null, '');
      };

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0] ? result[0].transcript : '';
          if (result.isFinal) final += text;
          else interim += text;
        }

        setInterimText(final || interim);

        if (final) {
          const cleaned = final.trim();
          teardown();
          if (cleaned) {
              // Hand the text back to the page. The page writes it into the real
              // input and lets Google Places take it from there.
              onResult?.(field, cleaned);
              setInterimText('');
            } else {
              setFieldMessage(field, 'No speech detected. Please try again.');
            }
          }
        };
  
        recognition.onerror = (event) => {
          const code = event && event.error;
          teardown();
          if (code === 'no-speech') {
            setFieldMessage(field, 'No speech detected. Please try again.');
          } else if (code === 'not-allowed' || code === 'service-not-allowed') {
            setFieldMessage(field, 'Microphone permission is required for voice search.');
          } else if (code === 'audio-capture') {
            setFieldMessage(field, 'No microphone was found. Please type the location.');
          } else if (code === 'aborted') {
            // User cancelled — stay silent rather than alarming them.
            setFieldMessage(null, '');
          } else {
            setFieldMessage(field, 'Voice search could not be started. Please try again.');
          }
        };

      recognition.onend = () => {
        recognitionRef.current = null;
        setListeningField(null);
        setInterimText('');
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch {
        teardown();
        setFieldMessage(field, 'Voice search could not be started. Please try again.');
      }
    },
    [language, listeningField, onResult, setFieldMessage, teardown]
  );

  const toggle = useCallback(
    (field) => {
      if (listeningField === field) stop();
      else start(field);
    },
    [listeningField, start, stop]
  );

  const clearMessage = useCallback(() => {
    setMessage('');
    setMessageField(null);
  }, []);

  // Never leave the microphone running after the user leaves the page.
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
    recognitionRef.current = null;
  }, []);

  return {
    supported,
    listeningField,
    interimText,
    message,
    messageField,
    clearMessage,
    start,
    stop,
    toggle,
  };
}
