# Code Arena — repository guidance

## Product

Code Arena is a model comparison arena. Users submit a prompt, run it against
multiple models, and compare the generated artifacts.

Initial comparison modes:

- **SVG generation:** models generate SVG artifacts for preview and comparison.
- **HTML + Three.js generation:** models generate HTML experiences that can use
  Three.js, with previews for comparison.

Keep new comparison modes extensible without building speculative frameworks.
Voting, scoring, leaderboards, and automatic judging are not yet decided.

## Workspace and ownership

This is an npm workspaces monorepo using TypeScript and Node.js 22 or newer.

### `apps/code-arena` — Next.js

- Owns the frontend, user handling, authentication, sessions, and authorization.
- Owns the arena experience: prompt entry, model selection, run submission,
  progress display, artifact previews, and comparison views.
- Calls the agent service through server-side application code. Validate user
  access before submitting runs or returning user-specific run data.
- Keep provider clients, tool execution, and agent orchestration out of this app.
- Read `apps/code-arena/AGENTS.md` and the relevant installed Next.js docs before
  changing Next.js code.

### `apps/agent` — Node.js

- Owns all agentic execution: the OpenRouter client, model calls, tools, run
  orchestration, execution state, and generated artifacts.
- Exposes a service API for Next.js. Treat run creation and run observation as
  explicit contracts rather than importing agent internals into the frontend.
- Enforces execution limits and validates inputs at its own service boundary.
- Keep user authentication flows and presentation logic out of this app.
- The default OpenRouter key stays on the agent server. Users may enter an
  optional session key in the browser; send it only through the Next.js proxy
  at session creation, then clear the input. Retain the provider client only
  in agent memory until session cleanup. Never return credentials in responses
  or include them in storage, prompts, generated artifacts, events, or logs.

Next.js provides the four-mode launcher and browser workspace. The agent exposes
authenticated session/run APIs and SSE on loopback; shared DTOs live in
`packages/contracts`. CLI and web compose the same runtime factory. Browser
sessions use opaque owner cookies and server-side API forwarding.

## Object-oriented design

- Use object-oriented design for agent domain behavior and application services.
  Encapsulate state and invariants in focused classes.
- Prefer composition over inheritance. Introduce interfaces at meaningful
  boundaries such as model providers, tools, run storage, and artifact handling.
- Inject dependencies through constructors so services can be tested without
  live provider calls. Avoid global clients and mutable singleton state.
- Keep HTTP handlers thin: validate and translate requests, invoke application
  services, and map results to responses.
- Keep provider-specific request and response shapes inside the OpenRouter
  adapter. Domain code should use application-owned types.
- Use plain typed objects for DTOs and small pure functions for stateless
  transformations. OOP does not require a class for every type or utility.
- Use idiomatic React function components and hooks in Next.js; do not introduce
  class components merely to satisfy the OOP preference.

Potential boundaries include a model client, tool registry, run orchestrator,
artifact validator, and run repository. Add these when features require them;
do not create empty abstractions up front.

## Runs and fair comparisons

- Distinguish a comparison from each individual model run. Failure or cancellation
  of one model run should not discard successful outputs from the others.
- Give compared models the same task prompt, mode, and tool policy. Record any
  model-specific settings or differences so comparisons are explainable.
- Track explicit run states and validate transitions. Preserve errors as run
  outcomes rather than silently dropping failed models.
- Record model identifiers, generation settings, timing, and usage/cost when
  available. Keep unavailable metrics explicit; do not fabricate values.
- Preserve the original generated output separately from any sanitized preview.
- Bound execution with timeouts, tool-call limits, and cancellation. Make retries
  explicit so duplicate calls and additional cost are observable.

## Contracts and generated content

- Validate external inputs at runtime; TypeScript types alone are insufficient.
- Use serializable request, response, event, and artifact types at app boundaries.
  If both apps need shared contracts, put them in a dedicated workspace package;
  do not import one app's source files into the other.
- Treat model output and tool arguments as untrusted. Preview generated SVG and
  HTML/Three.js in an isolated, sandboxed context with no access to application
  cookies, credentials, or privileged app APIs. Never inject raw generated markup
  into the application's document.
- Keep tools explicitly registered and constrained. Do not execute arbitrary
  model-generated code on the agent host as a default rendering strategy.
- Keep secrets in environment variables and provide placeholder `.env.example`
  files when configuration is introduced. Never commit real credentials.

## Working conventions

- Install dependencies from the repository root and maintain one root lockfile.
- Keep changes focused on the requested feature. Follow existing conventions
  and avoid adding infrastructure before it is needed.
- For behavioral changes, run the relevant workspace checks and add focused
  tests for meaningful domain behavior, service boundaries, and failure paths.
  Mock provider calls in routine tests.
- Root commands: `npm run dev`, `npm run build`, `npm run typecheck`, and
  `npm run lint`. Run agent tests with `npm run test --workspace=agent`.
- Ask before committing to unresolved product or infrastructure choices, such
  as the auth provider, database, queue, judging method, or hosted code execution.
  Continue independent work while those choices are pending.
