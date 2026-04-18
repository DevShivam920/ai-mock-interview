/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Play, 
  Award, 
  RefreshCcw, 
  CheckCircle2, 
  AlertCircle,
  BrainCircuit,
  Volume2
} from "lucide-react";
import { evaluateAnswer, EvaluationResult } from "./services/geminiService";

// --- Types ---
type AppStep = "IDLE" | "SETUP" | "INTERVIEW" | "RESULTS";

interface Question {
  id: number;
  text: string;
}

const QUESTIONS: Question[] = [
  { id: 1, text: "What is HTML and how does it organize content?" },
  { id: 2, text: "What is CSS, and why is it important for web design?" },
  { id: 3, text: "Explain what a JavaScript closure is with a simple example." },
  { id: 4, text: "How do you handle responsive design in your projects?" },
  { id: 5, text: "What are React hooks, and why are they used?" }
];

// --- Helpers ---
const speak = (text: string, onEnd?: () => void) => {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Try to find a nice female voice
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(v => v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("google")) || voices[0];
  if (preferredVoice) utterance.voice = preferredVoice;

  utterance.onend = () => {
    if (onEnd) onEnd();
  };
  window.speechSynthesis.speak(utterance);
};

export default function App() {
  const [step, setStep] = useState<AppStep>("IDLE");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [results, setResults] = useState<{ score: number; feedback: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [iraSpeech, setIraSpeech] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);

  // Sync stream to video element
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, isCameraActive, step]);

  // Initialize Voices
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        const currentTranscript = Array.from(event.results)
          .map((result: any) => (result as any)[0].transcript)
          .join("");
        setTranscript(currentTranscript);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Speak Helper inside component to access state
  const speakIra = (text: string, onEnd?: () => void) => {
    window.speechSynthesis.cancel();
    setIraSpeech(text);
    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("google")) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onend = () => {
      setIsSpeaking(false);
      if (onEnd) onEnd();
    };

    // Error safety: if it fails to start or gets blocked
    utterance.onerror = () => {
      setIsSpeaking(false);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
    
    // Fallback timer in case onend never fires
    const timer = setTimeout(() => {
      if (window.speechSynthesis.speaking === false && isSpeaking) {
        setIsSpeaking(false);
        if (onEnd) onEnd();
      }
    }, text.length * 100 + 2000);

    return () => clearTimeout(timer);
  };

  // Handle Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setCameraStream(stream);
      setIsCameraActive(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      setIsCameraActive(false);
    }
  };

  // Interview Logic
  const startInterview = async () => {
    // 1. Initial interaction to unlock audio
    await startCamera();
    setStep("INTERVIEW");
    setCurrentQuestionIndex(0);
    setResults([]);
    
    const intro = "Hi, I'm Ira, your AI interviewer. I'll ask you a few questions. Please answer using your voice after I finish speaking.";
    speakIra(intro, () => {
      askQuestion(0);
    });
  };

  const askQuestion = (index: number) => {
    if (index >= QUESTIONS.length) {
      setStep("RESULTS");
      stopCamera();
      speakIra("The interview is now complete. Thank you for your time. Let's see your results.");
      return;
    }

    const questionText = QUESTIONS[index].text;
    speakIra(questionText, () => {
      startListening();
    });
  };

  const startListening = () => {
    setTranscript("");
    setIsListening(true);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn("Recognition already started or failed", e);
      }
    }
  };

  // Evaluation
  const handleFinalAnswer = async () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);
    setIsEvaluating(true);

    const evaluation = await evaluateAnswer(QUESTIONS[currentQuestionIndex].text, transcript);
    setResults(prev => [...prev, evaluation]);
    setIsEvaluating(false);

    // Short delay before next question
    setTimeout(() => {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      askQuestion(nextIndex);
    }, 1000);
  };

  const totalScore = results.reduce((acc, curr) => acc + curr.score, 0);
  const averageScore = results.length > 0 ? (totalScore / results.length).toFixed(1) : "0";

  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#F5F5F0] font-sans flex flex-col items-center justify-center p-6">
      <main className="w-full max-w-5xl flex flex-col gap-6">
        <AnimatePresence mode="wait">
          {step !== "RESULTS" ? (
            <motion.div
              key="main-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="aspect-video bg-[#1a1c23] border border-cyan-500/40 rounded-xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-500 shadow-2xl">
                  <div className={`w-32 h-32 md:w-40 md:h-40 rounded-full border-4 ${isSpeaking ? 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.5)]' : 'border-[#2b2e3a]'} overflow-hidden transition-all duration-300 mb-4 bg-zinc-800`}>
                    <img 
                      src="https://picsum.photos/seed/interviewer/400/400" 
                      alt="Interviewer" 
                      className={`w-full h-full object-cover grayscale transition-all ${isSpeaking ? 'grayscale-0 scale-105' : 'opacity-80'}`}
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <p className="text-sm font-semibold tracking-wide text-gray-400">Interviewer (AI)</p>
                  
                  {isSpeaking && (
                    <div className="absolute bottom-4 flex gap-1 h-4">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [4, Math.random() * 12 + 4, 4] }}
                          transition={{ repeat: Infinity, duration: 0.4, delay: i * 0.05 }}
                          className="w-1 bg-cyan-400 rounded-full"
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="aspect-video bg-[#000] border border-zinc-900 rounded-xl relative overflow-hidden shadow-2xl">
                  {!isCameraActive ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700">
                      <VideoOff className="w-12 h-12 mb-2 opacity-50" />
                      <p className="text-xs font-bold uppercase tracking-widest">Camera Off</p>
                    </div>
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover brightness-90 contrast-110"
                      />
                      <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] font-black text-white tracking-[0.2em] uppercase">REC</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="w-full bg-[#16181d] rounded-xl p-8 border border-zinc-800/50 min-h-[220px] shadow-lg flex flex-col">
                <h3 className="text-gray-400 text-sm font-bold uppercase tracking-widest mb-6 px-1">Transcription</h3>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  {step === "IDLE" ? (
                    <p className="text-gray-600 italic">Your conversation will appear here...</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-cyan-500 animate-pulse' : isListening ? 'bg-orange-500 animate-ping' : 'bg-gray-700'}`} />
                        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                          {isSpeaking ? "Ira is speaking" : isListening ? "Listening" : isEvaluating ? "Evaluating" : "Ready"}
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <span className="text-[10px] text-zinc-600 uppercase font-black">AI Message</span>
                        <p className="text-gray-100 text-lg leading-relaxed">{iraSpeech || QUESTIONS[currentQuestionIndex].text}</p>
                      </div>

                      {step === "INTERVIEW" && (
                        <div className="space-y-2">
                          <span className="text-[10px] text-zinc-600 uppercase font-black">Your Input</span>
                          <p className={`text-xl font-medium ${transcript ? 'text-[#F27D26]' : 'text-zinc-700'}`}>
                            {transcript || (isListening ? "(Awaiting speech...)" : "")}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-center mt-4">
                {step === "IDLE" && (
                  <button
                    onClick={startInterview}
                    className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-10 py-3 rounded-lg font-bold transition-all shadow-xl shadow-blue-600/20 active:scale-95"
                  >
                    Start Interview
                  </button>
                )}
                {step === "INTERVIEW" && !isSpeaking && (
                  <button
                    onClick={handleFinalAnswer}
                    disabled={isEvaluating}
                    className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-10 py-3 rounded-lg font-bold transition-all shadow-xl shadow-blue-600/20 active:scale-95 disabled:opacity-50"
                  >
                    {isEvaluating ? "Evaluating..." : "Submit Answer"}
                  </button>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="results-view"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-4xl w-full mx-auto bg-[#1a1c23] rounded-3xl p-10 border border-zinc-800 shadow-2xl"
            >
              <div className="text-center mb-10">
                <Award className="w-16 h-16 text-cyan-400 mx-auto mb-4" />
                <h2 className="text-4xl font-black tracking-tight mb-2 text-white">Final Report</h2>
                <div className="bg-zinc-900/50 inline-block px-10 py-4 rounded-2xl border border-zinc-800 mt-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Final Score</p>
                  <p className="text-6xl font-black text-white">{averageScore}<span className="text-xl text-zinc-500">/10</span></p>
                </div>
              </div>

              <div className="space-y-4 mb-10 max-h-[400px] overflow-y-auto pr-4 custom-scrollbar">
                {results.map((res, i) => (
                  <div key={i} className="bg-[#16181d] p-6 rounded-2xl border border-zinc-800/50 flex gap-6">
                    <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center font-bold text-cyan-400 shrink-0">
                      {res.score}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-zinc-300 mb-1">Q: {QUESTIONS[i].text}</h4>
                      <p className="text-zinc-500 text-sm italic">{res.feedback}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-center">
                <button
                  onClick={() => {
                    setStep("IDLE");
                    setResults([]);
                    setIsCameraActive(false);
                    setCurrentQuestionIndex(0);
                    setIraSpeech("");
                    setTranscript("");
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2"
                >
                  <RefreshCcw className="w-4 h-4" /> Restart Session
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <div className="fixed bottom-6 text-zinc-800 font-black text-[8px] uppercase tracking-[1em]">
        AI Interview Platform • Proprietary Engine
      </div>
    </div>
  );
}
