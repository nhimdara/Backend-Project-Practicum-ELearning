const ALLOWED_MAJORS = ["ITE", "IT", "Mathematics"];
const EMAIL_DOMAIN = "elearning.com";
const EXAM_PASS_SCORE = 70;

const EXAM_BANK = {
  ITE: {
    title: "ITE Comprehensive Exam",
    description: "Information Technology Engineering readiness exam",
    accentColor: "#2563eb",
    questions: [
      {
        id: "ite-1",
        question: "Which layer of the OSI model is responsible for routing packets between networks?",
        options: ["Application", "Transport", "Network", "Data Link"],
        answer: 2,
      },
      {
        id: "ite-2",
        question: "What is the main purpose of a database index?",
        options: ["Encrypt table data", "Speed up data lookup", "Delete duplicate rows", "Create backups"],
        answer: 1,
      },
      {
        id: "ite-3",
        question: "In software engineering, what does API stand for?",
        options: ["Application Programming Interface", "Advanced Program Input", "Applied Protocol Internet", "Application Process Index"],
        answer: 0,
      },
      {
        id: "ite-4",
        question: "Which data structure uses FIFO order?",
        options: ["Stack", "Queue", "Tree", "Graph"],
        answer: 1,
      },
      {
        id: "ite-5",
        question: "What does HTTPS add to HTTP?",
        options: ["Compression", "Encryption through TLS", "Offline caching", "Database access"],
        answer: 1,
      },
    ],
  },
  IT: {
    title: "IT Comprehensive Exam",
    description: "Information Technology core skills exam",
    accentColor: "#0891b2",
    questions: [
      {
        id: "it-1",
        question: "Which command-line tool is commonly used to test network reachability?",
        options: ["ping", "mkdir", "sort", "rename"],
        answer: 0,
      },
      {
        id: "it-2",
        question: "What does SQL mainly help you do?",
        options: ["Design images", "Query and manage relational data", "Compile JavaScript", "Configure routers only"],
        answer: 1,
      },
      {
        id: "it-3",
        question: "Which protocol is commonly used to send email?",
        options: ["SMTP", "FTP", "SSH", "DNS"],
        answer: 0,
      },
      {
        id: "it-4",
        question: "What is two-factor authentication used for?",
        options: ["Faster downloads", "Extra login security", "Image compression", "Code formatting"],
        answer: 1,
      },
      {
        id: "it-5",
        question: "Which cloud concept means adding more servers to handle load?",
        options: ["Horizontal scaling", "Defragmentation", "Serialization", "Packet sniffing"],
        answer: 0,
      },
    ],
  },
  Mathematics: {
    title: "Mathematics Comprehensive Exam",
    description: "Mathematics foundation and reasoning exam",
    accentColor: "#7c3aed",
    questions: [
      {
        id: "math-1",
        question: "What is the derivative of x^2?",
        options: ["x", "2x", "x^3", "2"],
        answer: 1,
      },
      {
        id: "math-2",
        question: "If A = {1, 2} and B = {2, 3}, what is A union B?",
        options: ["{2}", "{1, 2, 3}", "{1, 3}", "{}"],
        answer: 1,
      },
      {
        id: "math-3",
        question: "What is the determinant of [[1, 0], [0, 1]]?",
        options: ["0", "1", "2", "-1"],
        answer: 1,
      },
      {
        id: "math-4",
        question: "Which number is prime?",
        options: ["21", "27", "29", "39"],
        answer: 2,
      },
      {
        id: "math-5",
        question: "What is the probability of getting heads when flipping a fair coin once?",
        options: ["0", "1/4", "1/2", "1"],
        answer: 2,
      },
    ],
  },
};

module.exports = { ALLOWED_MAJORS, EMAIL_DOMAIN, EXAM_PASS_SCORE, EXAM_BANK };
