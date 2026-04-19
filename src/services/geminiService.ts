import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ 
  apiKey: import.meta.env.VITE_GEMINI_API_KEY 
});

export interface EvaluationResult {
  score: number;
  feedback: string;
}

export async function evaluateAnswer(question: string, answer: string): Promise<EvaluationResult> {
  const prompt = `
    As a technical interviewer, evaluate the following candidate answer for the given question.
    
    Question: "${question}"
    Candidate Answer: "${answer}"
    
    Provide a score between 0 and 10 and a brief feedback. 
    Be constructive. If the answer is empty or completely irrelevant, score it 0.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: {
              type: Type.NUMBER,
              description: "The evaluation score from 0 to 10."
            },
            feedback: {
              type: Type.STRING,
              description: "Brief constructive feedback for the candidate."
            }
          },
          required: ["score", "feedback"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      score: result.score ?? 0,
      feedback: result.feedback ?? "Unable to evaluate answer."
    };
  } catch (error) {
    console.error("Evaluation error:", error);
    return {
      score: 0,
      feedback: "There was an error during evaluation."
    };
  }
}
