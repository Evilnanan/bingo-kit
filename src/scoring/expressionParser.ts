/**
 * Lightweight expression parser/evaluator for scoring rules.
 *
 * Grammar (precedence climbing):
 *
 *   expr      → ternary
 *   ternary   → or ("?" ternary ":" ternary)?
 *   or        → and ("||" and)*
 *   and       → comparison ("&&" comparison)*
 *   comparison→ addition (("==" | "!=" | "<" | ">" | "<=" | ">=") addition)?
 *   addition  → term (("+" | "-") term)*
 *   term      → unary (("*" | "/" | "%") unary)*
 *   unary     → ("!" | "-") unary | postfix
 *   postfix   → primary ( "." IDENT | "[" expr "]" | "(" args ")" )*
 *   primary   → NUMBER | STRING | IDENTIFIER | "(" expr ")"
 *             | "|" IDENTIFIER "|" expr
 *
 * Built-in functions: min, max, abs, floor, ceil, round, if
 * Higher-order: all(array, |x| pred), any(array, |x| pred)
 * Array methods: .all(|x| pred), .any(|x| pred), .indexOf(item), .length
 */

import type { ASTNode } from "./types";

// ============================================================
// Tokenizer
// ============================================================

type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "EQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LE"
  | "GE"
  | "AND"
  | "OR"
  | "NOT"
  | "QUESTION"
  | "COLON"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "DOT"
  | "LBRACKET"
  | "RBRACKET"
  | "PIPE"
  | "EOF";

interface Token {
  type: TokenType;
  value?: string | number;
  pos: number;
}

const KEYWORDS: Record<string, TokenType> = {};

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Numbers
    if (isDigit(ch)) {
      let num = "";
      while (i < expr.length && isDigit(expr[i])) {
        num += expr[i++];
      }
      if (i < expr.length && expr[i] === ".") {
        num += expr[i++];
        while (i < expr.length && isDigit(expr[i])) {
          num += expr[i++];
        }
      }
      tokens.push({ type: "NUMBER", value: parseFloat(num), pos: i });
      continue;
    }

    // Strings (single-quoted)
    if (ch === "'") {
      i++;
      let str = "";
      while (i < expr.length && expr[i] !== "'") {
        if (expr[i] === "\\" && i + 1 < expr.length) {
          i++;
          str += expr[i++];
        } else {
          str += expr[i++];
        }
      }
      if (i < expr.length) i++; // skip closing quote
      tokens.push({ type: "STRING", value: str, pos: i });
      continue;
    }

    // Strings (double-quoted)
    if (ch === '"') {
      i++;
      let str = "";
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === "\\" && i + 1 < expr.length) {
          i++;
          str += expr[i++];
        } else {
          str += expr[i++];
        }
      }
      if (i < expr.length) i++; // skip closing quote
      tokens.push({ type: "STRING", value: str, pos: i });
      continue;
    }

    // Identifiers
    if (isAlpha(ch)) {
      let ident = "";
      while (i < expr.length && (isAlpha(expr[i]) || isDigit(expr[i]))) {
        ident += expr[i++];
      }
      tokens.push({ type: "IDENT", value: ident, pos: i });
      continue;
    }

    // Two-character operators
    if (ch === "=" && i + 1 < expr.length && expr[i + 1] === "=") {
      tokens.push({ type: "EQ", pos: i });
      i += 2;
      continue;
    }
    if (ch === "!" && i + 1 < expr.length && expr[i + 1] === "=") {
      tokens.push({ type: "NEQ", pos: i });
      i += 2;
      continue;
    }
    if (ch === "<" && i + 1 < expr.length && expr[i + 1] === "=") {
      tokens.push({ type: "LE", pos: i });
      i += 2;
      continue;
    }
    if (ch === ">" && i + 1 < expr.length && expr[i + 1] === "=") {
      tokens.push({ type: "GE", pos: i });
      i += 2;
      continue;
    }
    if (ch === "&" && i + 1 < expr.length && expr[i + 1] === "&") {
      tokens.push({ type: "AND", pos: i });
      i += 2;
      continue;
    }
    if (ch === "|" && i + 1 < expr.length && expr[i + 1] === "|") {
      tokens.push({ type: "OR", pos: i });
      i += 2;
      continue;
    }

    // Single-character tokens
    switch (ch) {
      case "+":
        tokens.push({ type: "PLUS", pos: i });
        break;
      case "-":
        tokens.push({ type: "MINUS", pos: i });
        break;
      case "*":
        tokens.push({ type: "STAR", pos: i });
        break;
      case "/":
        tokens.push({ type: "SLASH", pos: i });
        break;
      case "%":
        tokens.push({ type: "PERCENT", pos: i });
        break;
      case "<":
        tokens.push({ type: "LT", pos: i });
        break;
      case ">":
        tokens.push({ type: "GT", pos: i });
        break;
      case "!":
        tokens.push({ type: "NOT", pos: i });
        break;
      case "?":
        tokens.push({ type: "QUESTION", pos: i });
        break;
      case ":":
        tokens.push({ type: "COLON", pos: i });
        break;
      case "(":
        tokens.push({ type: "LPAREN", pos: i });
        break;
      case ")":
        tokens.push({ type: "RPAREN", pos: i });
        break;
      case ",":
        tokens.push({ type: "COMMA", pos: i });
        break;
      case ".":
        tokens.push({ type: "DOT", pos: i });
        break;
      case "[":
        tokens.push({ type: "LBRACKET", pos: i });
        break;
      case "]":
        tokens.push({ type: "RBRACKET", pos: i });
        break;
      case "|":
        tokens.push({ type: "PIPE", pos: i });
        break;
      default:
        throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }
    i++;
  }

  tokens.push({ type: "EOF", pos: expr.length });
  return tokens;
}

// ============================================================
// Parser
// ============================================================

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private get current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.current;
    if (t.type !== type) {
      throw new Error(
        `Expected ${type} but got ${t.type} at position ${t.pos}`,
      );
    }
    return this.advance();
  }

  // expr → ternary
  parse(): ASTNode {
    const node = this.ternary();
    if (this.current.type !== "EOF") {
      throw new Error(
        `Unexpected token ${this.current.type} at position ${this.current.pos}`,
      );
    }
    return node;
  }

  // ternary → or ("?" ternary ":" ternary)?
  private ternary(): ASTNode {
    let node = this.or();
    if (this.current.type === "QUESTION") {
      this.advance();
      const thenExpr = this.ternary();
      this.expect("COLON");
      const elseExpr = this.ternary();
      node = { kind: "ternary", cond: node, thenExpr, elseExpr };
    }
    return node;
  }

  // or → and ("||" and)*
  private or(): ASTNode {
    let node = this.and();
    while (this.current.type === "OR") {
      this.advance();
      node = { kind: "binary", op: "OR", left: node, right: this.and() };
    }
    return node;
  }

  // and → comparison ("&&" comparison)*
  private and(): ASTNode {
    let node = this.comparison();
    while (this.current.type === "AND") {
      this.advance();
      node = {
        kind: "binary",
        op: "AND",
        left: node,
        right: this.comparison(),
      };
    }
    return node;
  }

  // comparison → addition (("==" | "!=" | "<" | ">" | "<=" | ">=") addition)?
  private comparison(): ASTNode {
    let node = this.addition();
    const op = this.current.type;
    if (
      op === "EQ" ||
      op === "NEQ" ||
      op === "LT" ||
      op === "GT" ||
      op === "LE" ||
      op === "GE"
    ) {
      this.advance();
      node = { kind: "binary", op, left: node, right: this.addition() };
    }
    return node;
  }

  // addition → term (("+" | "-") term)*
  private addition(): ASTNode {
    let node = this.term();
    while (this.current.type === "PLUS" || this.current.type === "MINUS") {
      const op = this.advance().type;
      node = { kind: "binary", op, left: node, right: this.term() };
    }
    return node;
  }

  // term → unary (("*" | "/" | "%") unary)*
  private term(): ASTNode {
    let node = this.unary();
    while (
      this.current.type === "STAR" ||
      this.current.type === "SLASH" ||
      this.current.type === "PERCENT"
    ) {
      const op = this.advance().type;
      node = { kind: "binary", op, left: node, right: this.unary() };
    }
    return node;
  }

  // unary → ("!" | "-") unary | postfix
  private unary(): ASTNode {
    if (this.current.type === "NOT" || this.current.type === "MINUS") {
      const op = this.advance().type;
      return { kind: "unary", op, expr: this.unary() };
    }
    return this.postfix();
  }

  // postfix → primary ( "." IDENT | "[" expr "]" | "(" args ")" )*
  private postfix(): ASTNode {
    let node = this.primary();

    while (true) {
      if (this.current.type === "DOT") {
        this.advance();
        const prop = this.expect("IDENT");
        node = { kind: "member", object: node, property: prop.value as string };
      } else if (this.current.type === "LBRACKET") {
        this.advance();
        const index = this.ternary(); // parse expression (don't use parse() — it demands EOF)
        this.expect("RBRACKET");
        node = { kind: "index", object: node, index };
      } else if (this.current.type === "LPAREN") {
        this.advance();
        const args: ASTNode[] = [];
        // Use string variable to avoid TS narrowing issues after advance()
        const afterLparen = this.current.type as string;
        if (afterLparen !== "RPAREN") {
          args.push(this.ternary());
          while ((this.current.type as string) === "COMMA") {
            this.advance();
            args.push(this.ternary());
          }
        }
        this.expect("RPAREN");
        // Distinguish function call from method call
        if (node.kind === "member") {
          // obj.method(args) → method node
          node = {
            kind: "method",
            object: node.object,
            method: node.property,
            args,
          };
        } else if (node.kind === "identifier") {
          node = { kind: "call", name: node.name, args };
        } else {
          throw new Error(
            `Cannot call non-function at position ${this.current.pos}`,
          );
        }
      } else {
        break;
      }
    }

    return node;
  }

  // primary → NUMBER | STRING | IDENTIFIER | "(" expr ")" | "|" IDENTIFIER "|" expr
  private primary(): ASTNode {
    const t = this.current;

    switch (t.type) {
      case "NUMBER":
        this.advance();
        return { kind: "literal", value: t.value as number };

      case "STRING":
        this.advance();
        return { kind: "literal", value: t.value as string };

      case "IDENT": {
        this.advance();
        const kw = KEYWORDS[t.value as string];
        if (kw) {
          throw new Error(
            `Unexpected keyword '${t.value}' at position ${t.pos}`,
          );
        }
        return { kind: "identifier", name: t.value as string };
      }

      case "LPAREN": {
        this.advance();
        const node = this.ternary();
        this.expect("RPAREN");
        return node;
      }

      case "PIPE": {
        this.advance(); // skip opening |
        const param = this.expect("IDENT");
        this.expect("PIPE"); // skip closing |
        const body = this.ternary();
        return { kind: "lambda", param: param.value as string, body };
      }

      default:
        throw new Error(`Unexpected token ${t.type} at position ${t.pos}`);
    }
  }
}

// ============================================================
// Evaluator
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EvalContext = Record<string, any>;

const BUILTINS: Record<string, (...args: number[]) => number> = {
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  abs: (x) => Math.abs(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  if: (c, t, f) => (c ? t : f),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toNumber(val: any): number {
  if (typeof val === "number") return val;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isTruthy(val: any): boolean {
  if (typeof val === "number") return val !== 0;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val.length > 0;
  return !!val;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function refEquals(a: any, b: any): boolean {
  return a === b;
}

/**
 * Evaluate a lambda against each element of an array.
 * Returns the result of the lambda body for each element.
 */
function applyLambda(
  lambda: ASTNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  element: any,
  baseCtx: EvalContext,
): number {
  if (lambda.kind !== "lambda") return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extendedCtx: EvalContext = Object.create(baseCtx as any);
  extendedCtx[lambda.param] = element;
  return toNumber(evaluate(lambda.body, extendedCtx));
}

function evaluateCall(name: string, args: ASTNode[], ctx: EvalContext): number {
  // Higher-order: all / any
  if (name === "all" || name === "any") {
    if (args.length !== 2) {
      console.warn(
        `${name}() expects 2 arguments (array, lambda), got ${args.length}`,
      );
      return 0;
    }
    const arr = evaluate(args[0], ctx);
    if (!Array.isArray(arr)) {
      console.warn(
        `${name}() first argument must be an array, got ${typeof arr}`,
      );
      return 0;
    }
    const lambda = args[1];
    if (lambda.kind !== "lambda") {
      console.warn(
        `${name}() second argument must be a lambda, got ${lambda.kind}`,
      );
      return 0;
    }
    if (name === "all") {
      for (const elem of arr) {
        if (!isTruthy(applyLambda(lambda, elem, ctx))) return 0;
      }
      return 1;
    } else {
      for (const elem of arr) {
        if (isTruthy(applyLambda(lambda, elem, ctx))) return 1;
      }
      return 0;
    }
  }

  // Regular builtins
  const fn = BUILTINS[name];
  if (!fn) {
    console.warn(`Unknown function: ${name}()`);
    return 0;
  }

  const evaluatedArgs = args.map((a) => toNumber(evaluate(a, ctx)));
  return fn(...evaluatedArgs);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evaluate(node: ASTNode, ctx: EvalContext): any {
  try {
    switch (node.kind) {
      case "literal":
        return node.value;

      case "identifier": {
        if (node.name in ctx) {
          return ctx[node.name];
        }
        // Walk up prototype chain (for lambda-extended contexts)
        let current = Object.getPrototypeOf(ctx);
        while (current) {
          if (node.name in current) return current[node.name];
          current = Object.getPrototypeOf(current);
        }
        console.warn(`Undefined variable: ${node.name}`);
        return 0;
      }

      case "member": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj: any = evaluate(node.object, ctx);
        if (obj == null) return 0;
        if (node.property === "length" && Array.isArray(obj)) return obj.length;
        if (typeof obj === "object" && node.property in obj)
          return obj[node.property];
        return 0;
      }

      case "index": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr: any = evaluate(node.object, ctx);
        if (!Array.isArray(arr)) return 0;
        const idx = toNumber(evaluate(node.index, ctx));
        if (idx < 0 || idx >= arr.length) return 0;
        return arr[idx];
      }

      case "method": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj: any = evaluate(node.object, ctx);
        if (obj == null) return 0;

        if (node.method === "indexOf") {
          if (!Array.isArray(obj)) return -1;
          const needle =
            node.args.length > 0 ? evaluate(node.args[0], ctx) : undefined;
          for (let i = 0; i < obj.length; i++) {
            if (refEquals(obj[i], needle)) return i;
          }
          return -1;
        }

        if (node.method === "length" && Array.isArray(obj)) return obj.length;

        if (node.method === "all" || node.method === "any") {
          if (!Array.isArray(obj)) {
            console.warn(`.${node.method}() can only be called on arrays`);
            return 0;
          }
          if (node.args.length === 0 || node.args[0].kind !== "lambda") {
            console.warn(
              `.${node.method}() expects a lambda argument: .${node.method}(|x| pred)`,
            );
            return 0;
          }
          const lambda = node.args[0];
          if (node.method === "all") {
            for (const elem of obj) {
              if (!isTruthy(applyLambda(lambda, elem, ctx))) return 0;
            }
            return 1;
          } else {
            for (const elem of obj) {
              if (isTruthy(applyLambda(lambda, elem, ctx))) return 1;
            }
            return 0;
          }
        }

        console.warn(`Unknown method: .${node.method}()`);
        return 0;
      }

      case "lambda":
        // Lambdas are not evaluated standalone — they're consumed by all/any.
        // Return the node itself so the call handler can use it.
        return node;

      case "unary": {
        const val = evaluate(node.expr, ctx);
        if (node.op === "NOT") return isTruthy(val) ? 0 : 1;
        if (node.op === "MINUS") return -toNumber(val);
        return 0;
      }

      case "binary": {
        const left = evaluate(node.left, ctx);
        const right = evaluate(node.right, ctx);
        const op = node.op;

        // Logical operators — short-circuit is handled by parser structure
        if (op === "OR" || op === "AND") {
          // Already short-circuited in parser (each side is parsed independently)
          // Here we just compute the final boolean
          // Actually the parser handles this correctly via `and` / `or` methods
          // ... but this case is for the binary node already created by parser.
          // Since the parser handles precedence with separate levels, the binary
          // nodes for || and && are already structured correctly.
          // Re-evaluate since left/right are already computed:
          const l = isTruthy(left);
          const r = isTruthy(right);
          return op === "AND" ? (l && r ? 1 : 0) : l || r ? 1 : 0;
        }

        const ln = toNumber(left);
        const rn = toNumber(right);

        switch (op) {
          case "PLUS":
            return ln + rn;
          case "MINUS":
            return ln - rn;
          case "STAR":
            return ln * rn;
          case "SLASH":
            return rn === 0 ? 0 : ln / rn;
          case "PERCENT":
            return rn === 0 ? 0 : ln % rn;
          case "EQ":
            return left === right ? 1 : 0;
          case "NEQ":
            return left !== right ? 1 : 0;
          case "LT":
            return ln < rn ? 1 : 0;
          case "GT":
            return ln > rn ? 1 : 0;
          case "LE":
            return ln <= rn ? 1 : 0;
          case "GE":
            return ln >= rn ? 1 : 0;
          default:
            return 0;
        }
      }

      case "ternary": {
        const cond = evaluate(node.cond, ctx);
        return isTruthy(cond)
          ? evaluate(node.thenExpr, ctx)
          : evaluate(node.elseExpr, ctx);
      }

      case "call": {
        return evaluateCall(node.name, node.args, ctx);
      }

      default:
        return 0;
    }
  } catch (e) {
    console.warn("Expression evaluation error:", e);
    return 0;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse an expression string into an AST. Throws on syntax errors.
 */
export function parse(expr: string): ASTNode {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  return parser.parse();
}

/**
 * Parse and evaluate an expression in one step. Returns a number.
 * Errors are caught and logged; returns 0 on failure.
 */
export function parseAndEvaluate(expr: string, ctx: EvalContext): number {
  try {
    const ast = parse(expr);
    return toNumber(evaluate(ast, ctx));
  } catch (e) {
    console.warn(`Expression parse error in "${expr}":`, e);
    return 0;
  }
}
