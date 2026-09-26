import { Router } from 'express';
import { toPublicQuestion, type ExamCatalog } from './catalog.ts';

const MAX_PRACTICE_QUESTIONS = 50;

export function examRoutes(catalog: ExamCatalog): Router {
  const router = Router();

  /** Totals for the landing page and the category chips on the dashboard. */
  router.get('/catalog', (_req, res) => {
    res.json({
      totalQuestions: catalog.totalQuestions(),
      categories: catalog.categories().map((category) => {
        const exams = catalog.list(category);
        return {
          category,
          examCount: exams.length,
          questionCount: exams.reduce((sum, e) => sum + e.questionCount, 0),
        };
      }),
    });
  });

  router.get('/exams', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    res.json(catalog.list(category));
  });

  router.get('/exams/:examId', (req, res) => {
    const exam = catalog.getExam(req.params.examId);
    if (!exam) {
      res.status(404).json({ error: 'Prova não encontrada' });
      return;
    }
    res.json({
      exam: exam.summary,
      questions: exam.questions.map((q) => toPublicQuestion(q, exam.summary.id)),
    });
  });

  /** Random questions for "Questão Relâmpago" (count=1) and "Mini Simulado" (count=10). */
  router.get('/practice/questions', (req, res) => {
    const count = Math.min(Math.max(Number(req.query.count) || 10, 1), MAX_PRACTICE_QUESTIONS);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;
    const picked = catalog.randomQuestions(count, { category, subject });
    res.json(picked.map(({ question, exam }) => toPublicQuestion(question, exam.id)));
  });

  return router;
}
