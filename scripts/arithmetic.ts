/** Small exact rational calculator. No eval, variables, functions or implicit multiplication. */
export type Rational = { n: bigint; d: bigint };
function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; }
function rat(n: bigint, d = 1n): Rational {
  if (!d) throw new Error('除数不能为零');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d); return { n: n / g, d: d / g };
}
export function calculate(expression: string): Rational {
  if (expression.length > 1000) throw new Error('算式过长');
  const src = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/（/g, '(').replace(/）/g, ')').replace(/\s/g, '').replace(/[=＝]$/, '');
  const tokens = src.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/^\-]/g) ?? [];
  if (!tokens.length || tokens.join('') !== src) throw new Error('仅支持数字、四则运算、括号及整数乘方');
  let p = 0; let depth = 0;
  function primary(): Rational {
    if (++depth > 64) throw new Error('算式嵌套过深');
    let value: Rational;
    const token = tokens[p++];
    if (token === '(') { value = sum(); if (tokens[p++] !== ')') throw new Error('括号不匹配'); }
    else if (token && /^(\d|\.)/.test(token)) {
      const [whole, decimal = ''] = token.split('.');
      if (decimal.length > 30 || whole.length > 60) throw new Error('数值精度超出支持范围');
      value = rat(BigInt((whole || '0') + decimal), 10n ** BigInt(decimal.length));
    } else throw new Error('缺少数字或括号');
    depth--; return value;
  }
  function power(): Rational {
    const base = primary();
    if (tokens[p] !== '^') return base;
    p++; const exponent = unary();
    if (exponent.d !== 1n || exponent.n < -12n || exponent.n > 12n) throw new Error('指数必须是 -12 到 12 的整数');
    if (exponent.n < 0n) return rat(base.d ** -exponent.n, base.n ** -exponent.n);
    return rat(base.n ** exponent.n, base.d ** exponent.n);
  }
  function unary(): Rational {
    if (tokens[p] === '+' || tokens[p] === '-') {
      const sign = tokens[p++]; const v = unary(); return sign === '-' ? rat(-v.n, v.d) : v;
    }
    return power();
  }
  function product(): Rational {
    let v = unary();
    while (tokens[p] === '*' || tokens[p] === '/') {
      const op = tokens[p++]; const b = unary();
      v = op === '*' ? rat(v.n * b.n, v.d * b.d) : rat(v.n * b.d, v.d * b.n);
    }
    return v;
  }
  function sum(): Rational {
    let v = product();
    while (tokens[p] === '+' || tokens[p] === '-') {
      const op = tokens[p++]; const b = product();
      v = rat(v.n * b.d + (op === '+' ? 1n : -1n) * b.n * v.d, v.d * b.d);
    }
    return v;
  }
  const result = sum(); if (p !== tokens.length) throw new Error('算式格式错误'); return result;
}
export function formatRational(v: Rational): string {
  if (v.d === 1n) return String(v.n);
  let d = v.d; while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n;
  if (d !== 1n) return `${v.n}/${v.d}`;
  const sign = v.n < 0n ? '-' : ''; let n = v.n < 0n ? -v.n : v.n;
  const integer = n / v.d; n %= v.d; let fraction = '';
  while (n) { n *= 10n; fraction += String(n / v.d); n %= v.d; }
  return `${sign}${integer}.${fraction}`;
}
export function solve(expression: string): string { return formatRational(calculate(expression)); }
