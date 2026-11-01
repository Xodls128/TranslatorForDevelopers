/*
 * 번역하지 않고 영어로 보존할 개발 용어 사전 (초기 선별본)
 *
 * mode
 * - exact   : 대소문자까지 정확히 일치할 때만 보존 (고유명사: 언어, 도구, 포맷)
 * - word    : 대소문자 무관, 복수형 포함 항상 보존 (일반 영어로는 거의 안 쓰이는 단어)
 * - context : 일반 단어와 겹치는 다의어. 아래 경우에만 보존
 *             1) 문장 중간에 대문자로 시작할 때 (Promise, Union)
 *             2) 제목처럼 단어 대부분이 대문자로 시작하는 문장일 때 (Structures and Unions)
 *             3) 바로 뒤에 type/keyword/method 같은 단서 단어가 올 때 (union type)
 *
 * 기준: 기계번역이 엉뚱하게 옮기는 단어를 우선한다. ("문자열"처럼 이미 잘 옮기는 단어는 넣지 않는다)
 * 사용자는 옵션 페이지에서 용어를 추가하거나 제외할 수 있다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const DEFAULT_TERMS = [
    // 언어, 런타임, 포맷
    ['C++', 'exact'], ['C#', 'exact'], ['F#', 'exact'], ['.NET', 'exact'],
    ['JavaScript', 'exact'], ['TypeScript', 'exact'], ['Python', 'exact'], ['Java', 'exact'],
    ['Kotlin', 'exact'], ['Swift', 'exact'], ['Rust', 'exact'], ['Ruby', 'exact'], ['Dart', 'exact'],
    ['Scala', 'exact'], ['Haskell', 'exact'], ['Elixir', 'exact'], ['Erlang', 'exact'], ['Lua', 'exact'],
    ['Perl', 'exact'], ['Golang', 'exact'], ['WebAssembly', 'exact'], ['Deno', 'exact'],
    ['Node.js', 'exact'], ['GraphQL', 'exact'],

    // 프레임워크, 도구, 플랫폼
    ['React', 'exact'], ['Vue', 'exact'], ['Angular', 'exact'], ['Svelte', 'exact'], ['Next.js', 'exact'],
    ['Nuxt', 'exact'], ['Django', 'exact'], ['Flask', 'exact'], ['FastAPI', 'exact'], ['Flutter', 'exact'],
    ['Riverpod', 'exact'], ['Redux', 'exact'], ['Docker', 'exact'], ['Kubernetes', 'exact'],
    ['Git', 'exact'], ['GitHub', 'exact'], ['GitLab', 'exact'], ['npm', 'exact'], ['pnpm', 'exact'],
    ['Webpack', 'exact'], ['Vite', 'exact'], ['Babel', 'exact'], ['ESLint', 'exact'], ['Prettier', 'exact'],
    ['Linux', 'exact'], ['macOS', 'exact'], ['iOS', 'exact'], ['Android', 'exact'],
    ['Spring', 'context'], ['Express', 'context'], ['Yarn', 'context'], ['Bun', 'context'],

    // 개발 용어 - 일반 영어와 거의 겹치지 않음
    ['closure', 'word'], ['callback', 'word'], ['middleware', 'word'], ['runtime', 'word'],
    ['mutex', 'word'], ['semaphore', 'word'], ['hoisting', 'word'], ['polyfill', 'word'],
    ['transpiler', 'word'], ['struct', 'word'], ['enum', 'word'], ['tuple', 'word'], ['lambda', 'word'],
    ['iterator', 'word'], ['getter', 'word'], ['setter', 'word'], ['boolean', 'word'],
    ['namespace', 'word'], ['typedef', 'word'], ['monad', 'word'], ['coroutine', 'word'],
    ['goroutine', 'word'], ['endpoint', 'word'], ['webhook', 'word'], ['payload', 'word'],
    ['singleton', 'word'], ['mixin', 'word'], ['generics', 'word'], ['props', 'word'],
    ['rebase', 'word'], ['linter', 'word'], ['bundler', 'word'], ['hydration', 'word'],
    ['memoization', 'word'], ['debounce', 'word'], ['shim', 'word'], ['boilerplate', 'word'],
    ['currying', 'word'], ['pull request', 'word'], ['race condition', 'word'],
    ['garbage collection', 'word'], ['garbage collector', 'word'], ['side effect', 'word'],
    ['syntactic sugar', 'word'], ['tree shaking', 'word'], ['hot reload', 'word'],
    ['edge case', 'word'], ['corner case', 'word'], ['first-class', 'word'], ['async', 'word'],
    ['await', 'word'], ['decorator', 'word'],

    // 개발 용어 - 일반 영어와 겹치는 다의어
    ['union', 'context'], ['structure', 'context'], ['promise', 'context'], ['future', 'context'],
    ['class', 'context'], ['trait', 'context'], ['map', 'context'], ['set', 'context'],
    ['slice', 'context'], ['hook', 'context'], ['thread', 'context'], ['heap', 'context'],
    ['stack', 'context'], ['queue', 'context'], ['shell', 'context'], ['branch', 'context'],
    ['commit', 'context'], ['merge', 'context'], ['fork', 'context'], ['throttle', 'context'],
    ['spread', 'context'], ['symbol', 'context'], ['record', 'context'], ['proxy', 'context'],
  ];

  // context 용어 바로 뒤에 오면 개발 용어로 판단하는 단서 단어
  const CONTEXT_CUES = [
    'keyword', 'keywords', 'type', 'types', 'statement', 'statements', 'declaration', 'declarations',
    'method', 'methods', 'function', 'functions', 'class', 'classes', 'object', 'objects',
    'interface', 'interfaces', 'operator', 'operators', 'variable', 'variables', 'property',
    'properties', 'field', 'fields', 'constructor', 'instance', 'instances', 'member', 'members',
    'literal', 'literals', 'expression', 'expressions', 'module', 'modules', 'component',
    'components', 'directive', 'syntax', 'API', 'APIs', 'implementation', 'definition',
  ];

  /*
   * 분야 묶음: 그 분야 문서에서만 개발 용어로 쓰이는 단어. 사이트(src/data/sites.js)나 옵션에 따라 켠다.
   * 켜진 묶음에 있는 단어는 기본 사전의 규칙보다 우선한다. (예: fork는 기본 사전에서는 다의어, 시스템 묶음에서는 항상 보존)
   * 실제 번역기에서 확인하기 전의 초기 선별본이다.
   */
  const TERM_PACKS = {
    web: [
      ['hydrate', 'word'], ['hydration', 'word'], ['render', 'word'], ['rerender', 'word'], ['mount', 'word'],
      ['unmount', 'word'], ['fallback', 'word'], ['bundle', 'word'], ['Suspense', 'exact'],
      ['service worker', 'word'], ['shadow DOM', 'word'], ['viewport', 'word'], ['reflow', 'word'],
      ['repaint', 'word'], ['hook', 'word'], ['state', 'context'], ['effect', 'context'],
    ],
    backend: [
      ['bean', 'word'], ['pod', 'word'], ['ingress', 'word'], ['egress', 'word'], ['sidecar', 'word'],
      ['replica', 'word'], ['shard', 'word'], ['sharding', 'word'], ['idempotent', 'word'],
      ['rollout', 'word'], ['load balancer', 'word'], ['health check', 'word'], ['DaemonSet', 'exact'],
      ['StatefulSet', 'exact'], ['ConfigMap', 'exact'], ['Deployment', 'context'], ['Service', 'context'],
    ],
    systems: [
      ['kernel', 'word'], ['syscall', 'word'], ['system call', 'word'], ['inode', 'word'], ['spinlock', 'word'],
      ['page fault', 'word'], ['page table', 'word'], ['mmap', 'word'], ['ioctl', 'word'], ['kmalloc', 'word'],
      ['kfree', 'word'], ['vmalloc', 'word'], ['printk', 'word'], ['softirq', 'word'], ['tasklet', 'word'],
      ['interrupt handler', 'word'], ['user space', 'word'], ['userspace', 'word'], ['kernel space', 'word'],
      ['fork', 'word'], ['pipe', 'word'], ['borrow checker', 'word'], ['unsafe', 'word'],
    ],
    embedded: [
      ['register', 'word'], ['interrupt', 'word'], ['peripheral', 'word'], ['firmware', 'word'],
      ['bootloader', 'word'], ['watchdog', 'word'], ['prescaler', 'word'], ['bit-banging', 'word'],
      ['flash', 'word'], ['pull-up', 'word'], ['pull-down', 'word'], ['open-drain', 'word'],
      ['push-pull', 'word'], ['baud rate', 'word'], ['duty cycle', 'word'], ['brownout', 'word'],
      ['deep sleep', 'word'], ['light sleep', 'word'],
    ],
  };

  const TERM_PACK_LABELS = {
    web: '웹',
    backend: '백엔드·인프라',
    systems: '시스템',
    embedded: '임베디드·하드웨어',
  };

  TFD.DEFAULT_TERMS = DEFAULT_TERMS;
  TFD.CONTEXT_CUES = CONTEXT_CUES;
  TFD.TERM_PACKS = TERM_PACKS;
  TFD.TERM_PACK_LABELS = TERM_PACK_LABELS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULT_TERMS, CONTEXT_CUES, TERM_PACKS, TERM_PACK_LABELS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
