// Text utilities for Precedent's deterministic matching: normalisation, concept synonyms, a product lexicon,
// tokenising and light stemming. Pure functions, no Forge APIs, so they run in unit tests too.

// Multi-word phrases and abbreviations that should count as one concept. Each entry maps a regular
// expression (applied to lower-cased text) to a canonical token. Order matters: longer phrases first.
// Some concepts also imply a broader one (for example a named LLM vendor implies "llm").
const BASE_CONCEPTS = [
  // Partner-facing interfaces are public ones.
  [/\b(?:partner|external|third[\s-]party)[\s-](?:apis?|integrations?|endpoints?|webhooks?)\b/g, ' $& public '],
  [/\bone[\s-]?time[\s-]?(?:pass(?:code|word)s?|codes?|pins?)\b/g, ' otp '],
  [/\botps?\b/g, ' otp '],
  [/\b(?:sms|text)[\s-]?codes?\b/g, ' sms otp '],
  [/\b(?:verification|security|login|sign[\s-]?in|one[\s-]?time)[\s-]?codes?\b/g, ' otp '],
  [/\b(?:two|2)[\s-]?(?:factor|step)(?:[\s-]?auth(?:entication)?)?\b/g, ' mfa '],
  [/\bmulti[\s-]?factor(?:[\s-]?auth(?:entication)?)?\b/g, ' mfa '],
  [/\bsecond[\s-]factors?\b/g, ' mfa '],
  [/\b(?:2fa|mfa|2sv)\b/g, ' mfa '],
  [/\btext[\s-]?messages?\b/g, ' sms '],
  // "Text the user a code", "Text me a code": texting is SMS.
  [/\btext(?:ed|ing|s)?\s+(?=(?:me|them|him|her|the user|the customer|users|customers|people|an? (?:code|otp|link|pin))\b)/g, ' sms '],
  [/\bsms\s+(?:otp|codes?|pins?|passcodes?)\b/g, ' sms otp '],
  [/\bpasskeys?\b/g, ' passkey '],
  [/\bwebauthn\b|\bfido2?\b/g, ' passkey '],
  [/\bauthenticator[\s-]?apps?\b|\btotp\b/g, ' totp '],
  [/\bpassword[\s-]?resets?\b/g, ' passwordreset '],
  [/\b(?:access|bearer|auth|authentication|refresh|session|id)[\s-]?tokens?\b|\bjwts?\b|\bauthori[sz]ation[\s-]headers?\b/g, ' authtoken '],
  [/\bpostgre(?:s|sql)\b|\bpg\b|\baurora[\s-]?postgres(?:ql)?\b|\bcloud sql for postgres(?:ql)?\b/g, ' postgres '],
  [/\bmongo(?:db)?(?:[\s-]atlas)?\b|\bdocumentdb\b/g, ' mongodb '],
  [/\b(?:k8s|kube|kubernetes|gke|eks|aks|openshift|kubectl|helm)\b/g, ' kubernetes '],
  [/\belastic container service\b/g, ' ecs '],
  [/\b(?:amazon |aws )?simple queue service\b/g, ' sqs '],
  [/\blarge[\s-]?language[\s-]?models?\b|\bllms?\b|\bgenai\b|\bgenerative ai\b/g, ' llm '],
  [/\b(?:open[\s-]?ai|chat[\s-]?gpt|gpt[\s-]?\d[\w.-]*|gpt)\b/g, ' openai llm '],
  [/\b(?:anthropic|claude)\b/g, ' anthropic llm '],
  [/\b(?:gemini|bard)\b/g, ' gemini llm '],
  [/\bfeature[\s-]?(?:flags?|toggles?|switches?)\b/g, ' featureflag '],
  [/\blaunch[\s-]?darkly\b/g, ' launchdarkly featureflag '],
  [/\breact[\s-]?native\b|\brn\b/g, ' reactnative '],
  [/\bkotlin[\s-]multiplatform\b|\bkmp\b/g, ' kmp '],
  [/\bpush[\s-]?notifications?\b/g, ' pushnotification '],
  [/\bpersonally[\s-]?identifiable[\s-]?information\b|\bpii\b|\bpersonal data\b/g, ' pii '],
  [/\b(?:e-?mail address(?:es)?|phone numbers?|dates? of birth|social security numbers?|ssns?|passport numbers?|home address(?:es)?)\b/g, ' pii $& '],
  [/\bfirebase[\s-]?cloud[\s-]?messaging\b|\bfcm\b/g, ' fcm pushnotification '],
  [/\b(?:credit[\s-]?)?card[\s_-]?numbers?\b|\bprimary account numbers?\b/g, ' cardnumber '],
  [/\bcall[\s-]?recordings?\b/g, ' callrecording '],
  [/\btranscripts?\b/g, ' transcript '],
  [/\bthird[\s-]?part(?:y|ies)\b|\b3rd[\s-]?party\b|\bexternal vendors?\b/g, ' thirdparty '],
  [/\bin[\s-]?house\b|\bhome[\s-]?(?:grown|built|rolled)\b|\bbuild our own\b/g, ' inhouse '],
  [/\bself[\s-]?host(?:ed|ing)?\b/g, ' selfhosted '],
  [/\bon[\s-]?prem(?:ise|ises)?\b/g, ' onprem '],
  [/\bon[\s-]call\b/g, ' oncall '],
  [/\bdata[\s-]?residency\b/g, ' dataresidency '],
  [/\bapp[\s-]?store\b/g, ' appstore '],
  [/\bci\/cd\b/g, ' cicd '],
  // Words that mean something else in a phrase: signing in is not logging.
  [/\blog(?:ging|ged)?[\s-]?(?:in|into|on)\b(?!\s+(?:files?|lines?|levels?|format|json|plain))/g, ' login '],
  [/\blog(?:ging|ged)?[\s-]?(?:out|off)\b/g, ' logout '],
  [/\binter-(?=[a-z])/g, 'inter'],
  // Versions that matter: "iOS 15" is not "iOS 16".
  [/\b(ios|ipados|android|macos|watchos)\s?(\d{1,2})(?:\.\d+)*\b/g, ' $1 $1$2 '],
  [/\[(?:ios|android)\]|\b(?:ios|android) apps?\b/g, ' $& mobile '],
  [/\bsha[\s-]?1\b/g, ' sha1 '],
  [/\bsha[\s-]?256\b/g, ' sha256 '],
  [/\bmd[\s-]?5\b/g, ' md5 '],
  [/\bplain[\s-]?(?:old[\s-]?)?(?:javascript|js)\b|\bvanilla[\s-]?(?:javascript|js)\b/g, ' plainjs javascript '],
  [/\bjavascript\b|\bjs\b/g, ' javascript '],
  [/\btypescript\b|\bts\b/g, ' typescript '],
  [/\bmicro[\s-]?frontends?\b/g, ' microfrontend '],
  [/\bhamburger(?:[\s-]+(?:menus?|drawers?|navigation|nav|icons?))?\b/g, ' hamburgermenu '],
  [/\bblue[\s/-]?green\b/g, ' bluegreen '],
  [/\b(?:os|system|device)[\s-](?:settings?|preferences?|themes?|appearance)\b|\bprefers-color-scheme\b/g, ' ossetting '],
  [/\bdate[\s-]based version(?:s|ing| numbers?)?\b|\bcalver\b/g, ' calver '],
  [/\bsem(?:antic)?[\s-]?ver(?:sioning)?\b/g, ' semver '],
  [/\badrs?\b|\barchitecture decision records?\b/g, ' adr architecture decision '],
  [/\blocal[\s-]?storage\b/g, ' localstorage '],
  [/\bencrypt(?:ion|ed|ing|s)?\b/g, ' encrypt '],
  [/\bdeploy(?:ment|ments|s|ed|ing)?\b/g, ' deploy '],
  [/\bship(?:s|ped)?\b/g, ' ship deploy '],
  [/\bhot[\s-]?fix(?:es)?\b/g, ' hotfix '],
  // Real customer data from production, however it is described.
  [/\b(?:prod(?:uction)?|live|real)[\s-](?:data(?:base)?|db|snapshots?|dumps?|backups?|records)\b/g, ' productiondata production '],
  [/\bprod\b/g, ' production '],
  [/\bcrontab\b|\bcron[\s-]?jobs?\b/g, ' cron '],
  // Data about customers, however a ticket names it ("the users table", "the customer's name and email").
  [/\b(?:customer|user|client|member|personal)s?[\s-](?:data|records?|tables?|details|information|info|profiles?|pii|names?|e-?mails?|phone numbers?|address(?:es)?)\b/g, ' customerdata pii $& '],
  [/\b(?:reviewers?|approvals?|approvers?|code reviews?|sign[\s-]?offs?)\b/g, ' approval '],
  [/\b(?:image |testimonial |hero |logo )?sliders?\b|\brotating banners?\b|\bcarousels?\b/g, ' carousel '],
  [/\bhome[\s-]?page\b|\blanding pages?\b/g, ' $& marketing site '],
  // A Slack channel: "#payments".
  [/(?:^|\s)#(?!\d)[a-z][\w-]*/g, ' slack '],
  // Regions: "us-east-1", "eu-central-1", "the EU".
  [/\beu[\s-](?:west|central|north|south)[\s-]\d\b|\b(?:the )?eu\b|\beurope(?:an union)?\b|\bfrankfurt\b|\bireland\b/g, ' euregion '],
  [/\bus[\s-](?:east|west|central)[\s-]\d\b|\busa\b|\bunited states\b|\bnorth america\b/g, ' usregion '],
  [/\bap[\s-](?:southeast|northeast|south)[\s-]\d\b|\bapac\b|\bsingapore\b/g, ' apacregion '],
];

// Products by category: [category, canonical token, display name, extra aliases]. A decision that chose one member
// of a category is contradicted by work that adopts another member ("Use DynamoDB" against "Postgres for new services").
// The words after each category are what a decision's scope may call that category ("caching" for caches).
const CATEGORIES = {
  database: { label: 'database', words: 'database datastore db store storage persistence transactional oltp schema' },
  warehouse: { label: 'data warehouse', words: 'warehouse analytics analytic reporting bi olap' },
  cache: { label: 'cache', words: 'cache caching session' },
  streaming: { label: 'event streaming platform', words: 'event events streaming stream bus messaging pubsub topic' },
  jobqueue: { label: 'job queue', words: 'job jobs queue queues background worker workers task tasks' },
  orchestration: { label: 'container platform', words: 'container containers orchestration workload workloads cluster' },
  hosting: { label: 'hosting platform', words: 'hosting host' },
  cloud: { label: 'cloud provider', words: 'cloud infrastructure region hosting' },
  iac: { label: 'infrastructure-as-code tool', words: 'infrastructure iac provisioning cloud' },
  ci: { label: 'CI system', words: 'ci pipeline pipelines build builds cicd' },
  cd: { label: 'deployment tool', words: 'deploy deploys pipeline cd gitops' },
  language: { label: 'language', words: 'language' },
  frontend: { label: 'frontend framework', words: 'frontend web ui spa' },
  mobile: { label: 'mobile framework', words: 'mobile ios android app apps' },
  apistyle: { label: 'API style', words: 'api apis endpoint endpoints interface' },
  identity: { label: 'identity provider', words: 'identity login sso auth authentication signin' },
  featureflags: { label: 'feature flag service', words: 'featureflag flag flags toggle toggles rollout experiment' },
  monitoring: { label: 'monitoring tool', words: 'monitoring apm metrics observability tracing telemetry dashboards' },
  logging: { label: 'log management tool', words: 'logging logs log observability' },
  errors: { label: 'error tracker', words: 'error errors crash crashes exception exceptions tracking' },
  analytics: { label: 'product analytics tool', words: 'analytics analytic tracking funnel funnels event events' },
  replay: { label: 'session replay tool', words: 'session replay heatmap heatmaps recording recordings analytics' },
  payments: { label: 'payment provider', words: 'payment payments checkout billing' },
  email: { label: 'email provider', words: 'email emails mail newsletter' },
  sms: { label: 'SMS provider', words: 'sms text texts messaging notification notifications outbound' },
  support: { label: 'support desk', words: 'support helpdesk ticket tickets' },
  oncall: { label: 'on-call tool', words: 'oncall paging incident incidents rotation rotations' },
  chat: { label: 'chat tool', words: 'chat messaging' },
  tracker: { label: 'issue tracker', words: 'bug bugs issue issues ticket tickets tracking backlog' },
  docs: { label: 'documentation tool', words: 'doc docs documentation wiki adr architecture decision decisions' },
  search: { label: 'search engine', words: 'search indexing index' },
  packages: { label: 'package manager', words: 'package packages dependency dependencies lockfile install javascript node repo repos monorepo workspace workspaces' },
  testing: { label: 'test framework', words: 'test tests testing e2e' },
  llm: { label: 'LLM provider', words: 'llm ai model models' },
  icons: { label: 'icon set', words: 'icon icons iconography' },
  fonts: { label: 'font', words: 'font fonts typography typeface text ui' },
  gateway: { label: 'API gateway', words: 'gateway ingress edge api apis' },
  versioning: { label: 'versioning scheme', words: 'version versions versioning release releases sdk sdks' },
  region: { label: 'region', words: 'region regions residency datacenter location hosting' },
};

const PRODUCTS = [
  ['database', 'postgres', 'PostgreSQL'], ['database', 'mysql', 'MySQL'], ['database', 'mariadb', 'MariaDB'], ['database', 'mongodb', 'MongoDB'],
  ['database', 'dynamodb', 'DynamoDB', /\bdynamo(?:[\s-]?db)?\b/g], ['database', 'cassandra', 'Cassandra'], ['database', 'cockroachdb', 'CockroachDB', /\bcockroach(?:[\s-]?db)?\b/g],
  ['database', 'sqlserver', 'SQL Server', /\b(?:ms[\s-]?)?sql[\s-]server\b|\bmssql\b/g], ['database', 'couchbase', 'Couchbase'], ['database', 'firestore', 'Firestore'],
  ['database', 'cosmosdb', 'Cosmos DB', /\bcosmos[\s-]?db\b/g], ['database', 'sqlite', 'SQLite'], ['database', 'spanner', 'Spanner'], ['database', 'neo4j', 'Neo4j'],
  ['database', 'couchdb', 'CouchDB'], ['database', 'scylladb', 'ScyllaDB', /\bscylla(?:[\s-]?db)?\b/g], ['database', 'supabase', 'Supabase'], ['database', 'planetscale', 'PlanetScale'],
  ['database', 'oracledb', 'Oracle Database', /\boracle(?:[\s-]?db| database)\b/g],
  ['warehouse', 'bigquery', 'BigQuery', /\bbig[\s-]?query\b/g], ['warehouse', 'snowflake', 'Snowflake'], ['warehouse', 'redshift', 'Redshift'], ['warehouse', 'databricks', 'Databricks'],
  ['warehouse', 'synapse', 'Azure Synapse', /\b(?:azure )?synapse(?: analytics)?\b/g], ['warehouse', 'clickhouse', 'ClickHouse'],
  ['cache', 'redis', 'Redis', /\b(?:azure cache for |amazon elasticache for |elasticache for )?redis\b/g], ['cache', 'memcached', 'Memcached', /\bmemcached?\b/g], ['cache', 'valkey', 'Valkey'], ['cache', 'hazelcast', 'Hazelcast'],
  ['streaming', 'kafka', 'Kafka', /\b(?:apache |confluent )?kafka\b|\bamazon msk\b/g], ['streaming', 'rabbitmq', 'RabbitMQ', /\brabbit[\s-]?mq\b/g], ['streaming', 'kinesis', 'Kinesis'],
  ['streaming', 'pubsub', 'Pub/Sub', /\b(?:google |cloud |gcp )?pub\s?\/\s?sub\b|\bpubsub\b/g], ['streaming', 'pulsar', 'Pulsar'], ['streaming', 'nats', 'NATS'], ['streaming', 'eventhubs', 'Event Hubs', /\bevent[\s-]?hubs?\b/g],
  ['streaming', 'activemq', 'ActiveMQ'],
  ['jobqueue', 'sqs', 'SQS'], ['jobqueue', 'rabbitmq', 'RabbitMQ'], ['jobqueue', 'celery', 'Celery'], ['jobqueue', 'sidekiq', 'Sidekiq'], ['jobqueue', 'bullmq', 'BullMQ'], ['jobqueue', 'resque', 'Resque'],
  ['jobqueue', 'delayedjob', 'delayed_job', /\bdelayed[\s_-]?jobs?\b/g], ['jobqueue', 'cloudtasks', 'Cloud Tasks', /\bcloud tasks\b/g],
  ['orchestration', 'kubernetes', 'Kubernetes'], ['orchestration', 'ecs', 'ECS'], ['orchestration', 'nomad', 'Nomad'], ['orchestration', 'dockerswarm', 'Docker Swarm', /\bdocker swarm\b/g],
  ['hosting', 'heroku', 'Heroku'], ['hosting', 'vercel', 'Vercel'], ['hosting', 'netlify', 'Netlify'], ['hosting', 'cloudrun', 'Cloud Run', /\bcloud run\b/g], ['hosting', 'appengine', 'App Engine', /\bapp engine\b/g],
  ['hosting', 'elasticbeanstalk', 'Elastic Beanstalk', /\belastic beanstalk\b/g], ['hosting', 'flyio', 'Fly.io', /\bfly\.io\b/g],
  ['cloud', 'aws', 'AWS'], ['cloud', 'gcp', 'Google Cloud', /\bgoogle cloud(?: platform)?\b|\bgcp\b/g], ['cloud', 'azure', 'Azure'], ['cloud', 'digitalocean', 'DigitalOcean', /\bdigital[\s-]?ocean\b/g],
  ['cloud', 'hetzner', 'Hetzner'], ['cloud', 'linode', 'Linode'],
  ['iac', 'terraform', 'Terraform', /\bterraform\b|\bopentofu\b/g], ['iac', 'pulumi', 'Pulumi'], ['iac', 'cloudformation', 'CloudFormation', /\bcloud[\s-]?formation\b/g], ['iac', 'cdk', 'AWS CDK'],
  ['iac', 'crossplane', 'Crossplane'], ['iac', 'bicep', 'Bicep'], ['iac', 'ansible', 'Ansible'],
  ['ci', 'githubactions', 'GitHub Actions', /\b(?:github|gh)[\s-]actions\b/g], ['ci', 'jenkins', 'Jenkins'], ['ci', 'circleci', 'CircleCI', /\bcircle[\s-]?ci\b/g], ['ci', 'gitlabci', 'GitLab CI', /\bgitlab[\s-]?ci\b/g],
  ['ci', 'travisci', 'Travis CI', /\btravis[\s-]?ci\b/g], ['ci', 'bitbucketpipelines', 'Bitbucket Pipelines', /\bbitbucket pipelines\b/g], ['ci', 'buildkite', 'Buildkite'], ['ci', 'teamcity', 'TeamCity'],
  ['ci', 'azurepipelines', 'Azure Pipelines', /\bazure (?:pipelines|devops)\b/g],
  ['cd', 'argocd', 'Argo CD', /\bargo(?:[\s-]?cd)?\b/g], ['cd', 'fluxcd', 'Flux CD', /\bflux[\s-]?cd\b/g], ['cd', 'spinnaker', 'Spinnaker'], ['cd', 'octopusdeploy', 'Octopus Deploy', /\boctopus deploy\b/g],
  ['language', 'golang', 'Go'], ['language', 'python', 'Python', /\bpython\b|\bdjango\b|\bflask\b|\bfastapi\b/g], ['language', 'ruby', 'Ruby', /\bruby(?: on rails)?\b|(?<!guard[\s-]?)\brails\b|\bsinatra\b/g],
  ['language', 'java', 'Java', /\bjava\b|\bspring boot\b/g], ['language', 'kotlin', 'Kotlin'], ['language', 'scala', 'Scala'], ['language', 'rust', 'Rust'], ['language', 'php', 'PHP', /\bphp\b|\blaravel\b|\bsymfony\b/g],
  ['language', 'elixir', 'Elixir'], ['language', 'csharp', 'C#', /\bc#|\bcsharp\b|\b\.net\b|\bdotnet\b/g], ['language', 'swift', 'Swift'], ['language', 'typescript', 'TypeScript'], ['language', 'javascript', 'JavaScript'],
  ['language', 'perl', 'Perl'], ['language', 'clojure', 'Clojure'], ['language', 'dart', 'Dart'],
  ['frontend', 'reactjs', 'React', /\breact(?:\.?js)?\b(?!\s+(?:to|on|when|quickly)\b)/g], ['frontend', 'angular', 'Angular', /\bangular(?:js)?\b/g], ['frontend', 'vue', 'Vue', /\bvue(?:\.?js)?\b/g],
  ['frontend', 'svelte', 'Svelte', /\bsvelte(?:kit)?\b/g], ['frontend', 'emberjs', 'Ember', /\bember(?:\.?js)?\b/g], ['frontend', 'solidjs', 'SolidJS'],
  ['mobile', 'reactnative', 'React Native'], ['mobile', 'flutter', 'Flutter'], ['mobile', 'xamarin', 'Xamarin'], ['mobile', 'ionic', 'Ionic'], ['mobile', 'cordova', 'Cordova'], ['mobile', 'capacitor', 'Capacitor'],
  ['mobile', 'kmp', 'Kotlin Multiplatform'],
  ['apistyle', 'restapi', 'REST', /\brest(?:ful)?(?=\s+(?:api|apis|endpoints?|with|over|for|style|interface)\b)|(?<!\bat\s)\brest\b(?=[.,;]|$)/g], ['apistyle', 'graphql', 'GraphQL'], ['apistyle', 'grpc', 'gRPC'], ['apistyle', 'soap', 'SOAP'], ['apistyle', 'trpc', 'tRPC'],
  ['identity', 'okta', 'Okta'], ['identity', 'auth0', 'Auth0'], ['identity', 'cognito', 'Cognito', /\b(?:aws |amazon )?cognito\b/g], ['identity', 'keycloak', 'Keycloak'],
  ['identity', 'azuread', 'Microsoft Entra ID', /\bazure (?:ad|active directory)\b|\bentra(?: id)?\b/g], ['identity', 'firebaseauth', 'Firebase Auth', /\bfirebase auth(?:entication)?\b/g], ['identity', 'onelogin', 'OneLogin'],
  ['identity', 'stytch', 'Stytch'], ['identity', 'fusionauth', 'FusionAuth'],
  ['featureflags', 'launchdarkly', 'LaunchDarkly'], ['featureflags', 'unleash', 'Unleash'], ['featureflags', 'splitio', 'Split', /\bsplit\.io\b/g], ['featureflags', 'flagsmith', 'Flagsmith'],
  ['featureflags', 'configcat', 'ConfigCat'], ['featureflags', 'statsig', 'Statsig'], ['featureflags', 'growthbook', 'GrowthBook'],
  ['monitoring', 'datadog', 'Datadog'], ['monitoring', 'newrelic', 'New Relic', /\bnew[\s-]?relic\b/g], ['monitoring', 'dynatrace', 'Dynatrace'], ['monitoring', 'prometheus', 'Prometheus'],
  ['monitoring', 'grafana', 'Grafana'], ['monitoring', 'appdynamics', 'AppDynamics'], ['monitoring', 'honeycomb', 'Honeycomb'], ['monitoring', 'signoz', 'SigNoz'], ['monitoring', 'instana', 'Instana'],
  ['logging', 'splunk', 'Splunk'], ['logging', 'elk', 'ELK', /\belk\b|\blogstash\b|\bkibana\b/g], ['logging', 'loki', 'Loki'], ['logging', 'papertrail', 'Papertrail'], ['logging', 'sumologic', 'Sumo Logic', /\bsumo[\s-]?logic\b/g],
  ['logging', 'graylog', 'Graylog'], ['logging', 'logzio', 'Logz.io', /\blogz\.io\b/g],
  ['errors', 'sentry', 'Sentry'], ['errors', 'bugsnag', 'Bugsnag'], ['errors', 'rollbar', 'Rollbar'], ['errors', 'raygun', 'Raygun'], ['errors', 'airbrake', 'Airbrake'], ['errors', 'crashlytics', 'Crashlytics'],
  ['errors', 'honeybadger', 'Honeybadger'],
  ['analytics', 'mixpanel', 'Mixpanel'], ['analytics', 'amplitude', 'Amplitude'], ['analytics', 'posthog', 'PostHog'], ['analytics', 'googleanalytics', 'Google Analytics', /\bgoogle analytics\b|\bga4\b/g],
  ['analytics', 'pendo', 'Pendo'], ['analytics', 'heapanalytics', 'Heap', /\bheap analytics\b/g], ['analytics', 'plausibleanalytics', 'Plausible', /bplausible analyticsb/g], ['analytics', 'matomo', 'Matomo'],
  ['replay', 'hotjar', 'Hotjar'], ['replay', 'fullstory', 'FullStory'], ['replay', 'logrocket', 'LogRocket'], ['replay', 'smartlook', 'Smartlook'],
  ['payments', 'stripe', 'Stripe'], ['payments', 'adyen', 'Adyen'], ['payments', 'braintree', 'Braintree'], ['payments', 'paypal', 'PayPal'], ['payments', 'checkoutcom', 'Checkout.com', /\bcheckout\.com\b/g],
  ['payments', 'worldpay', 'Worldpay'], ['payments', 'mollie', 'Mollie'], ['payments', 'razorpay', 'Razorpay'], ['payments', 'paddle', 'Paddle'],
  ['email', 'postmark', 'Postmark'], ['email', 'mailgun', 'Mailgun'], ['email', 'sendgrid', 'SendGrid'], ['email', 'ses', 'Amazon SES', /\b(?:amazon |aws )?ses\b/g], ['email', 'mailchimp', 'Mailchimp'],
  ['email', 'mandrill', 'Mandrill'], ['email', 'sparkpost', 'SparkPost'], ['email', 'mailjet', 'Mailjet'], ['email', 'brevo', 'Brevo'],
  ['sms', 'twilio', 'Twilio'], ['sms', 'messagebird', 'MessageBird', /\bmessage[\s-]?bird\b/g], ['sms', 'vonage', 'Vonage', /\bvonage\b|\bnexmo\b/g], ['sms', 'plivo', 'Plivo'], ['sms', 'sinch', 'Sinch'], ['sms', 'telnyx', 'Telnyx'],
  ['support', 'zendesk', 'Zendesk'], ['support', 'intercom', 'Intercom'], ['support', 'freshdesk', 'Freshdesk'], ['support', 'helpscout', 'Help Scout', /\bhelp[\s-]?scout\b/g], ['support', 'gorgias', 'Gorgias'],
  ['support', 'kustomer', 'Kustomer'],
  ['oncall', 'pagerduty', 'PagerDuty', /\bpager[\s-]?duty\b/g], ['oncall', 'opsgenie', 'Opsgenie', /\bops[\s-]?genie\b/g], ['oncall', 'victorops', 'VictorOps'], ['oncall', 'incidentio', 'incident.io', /\bincident\.io\b/g],
  ['oncall', 'firehydrant', 'FireHydrant'],
  ['chat', 'slack', 'Slack'], ['chat', 'msteams', 'Microsoft Teams', /\b(?:microsoft|ms) teams\b/g], ['chat', 'discord', 'Discord'], ['chat', 'mattermost', 'Mattermost'], ['chat', 'googlechat', 'Google Chat', /\bgoogle chat\b/g],
  ['tracker', 'jira', 'Jira'], ['tracker', 'githubissues', 'GitHub Issues', /\bgithub issues?\b/g], ['tracker', 'asana', 'Asana'], ['tracker', 'trello', 'Trello'], ['tracker', 'youtrack', 'YouTrack'],
  ['tracker', 'clickup', 'ClickUp'], ['tracker', 'shortcutapp', 'Shortcut', /\bshortcut\.com\b/g],
  ['docs', 'confluence', 'Confluence'], ['docs', 'notionhq', 'Notion', /\bnotion(?= (?:page|pages|doc|docs|workspace|database))\b/g], ['docs', 'googledocs', 'Google Docs', /\bgoogle docs?\b/g], ['docs', 'gitbook', 'GitBook'],
  ['docs', 'sharepoint', 'SharePoint'], ['docs', 'markdown', 'Markdown files', /\bmarkdown(?: files?)?\b/g],
  ['search', 'elasticsearch', 'Elasticsearch', /\belastic[\s-]?search\b/g], ['search', 'opensearch', 'OpenSearch', /\bopen[\s-]?search\b/g], ['search', 'algolia', 'Algolia'], ['search', 'solr', 'Solr'],
  ['search', 'meilisearch', 'Meilisearch'], ['search', 'typesense', 'Typesense'],
  ['packages', 'npm', 'npm'], ['packages', 'yarn', 'Yarn'], ['packages', 'pnpm', 'pnpm'],
  ['testing', 'jest', 'Jest'], ['testing', 'vitest', 'Vitest'], ['testing', 'mochajs', 'Mocha', /\bmocha(?= (?:tests?|suite|runner))\b/g], ['testing', 'cypress', 'Cypress'], ['testing', 'playwright', 'Playwright'],
  ['testing', 'selenium', 'Selenium'], ['testing', 'pytest', 'pytest'], ['testing', 'rspec', 'RSpec'], ['testing', 'junit', 'JUnit'], ['testing', 'puppeteer', 'Puppeteer'],
  ['llm', 'openai', 'OpenAI'], ['llm', 'anthropic', 'Anthropic'], ['llm', 'gemini', 'Gemini'], ['llm', 'mistral', 'Mistral'], ['llm', 'cohere', 'Cohere'], ['llm', 'llama', 'Llama'],
  ['icons', 'lucide', 'Lucide'], ['icons', 'fontawesome', 'Font Awesome', /\bfont[\s-]?awesome\b/g], ['icons', 'heroicons', 'Heroicons'], ['icons', 'materialicons', 'Material Icons', /\bmaterial (?:icons|symbols)\b/g],
  ['icons', 'feathericons', 'Feather', /\bfeather icons\b/g], ['icons', 'phosphoricons', 'Phosphor', /\bphosphor(?: icons)?\b/g],
  ['fonts', 'inter', 'Inter'], ['fonts', 'roboto', 'Roboto'], ['fonts', 'helvetica', 'Helvetica'], ['fonts', 'arial', 'Arial'], ['fonts', 'opensans', 'Open Sans', /\bopen sans\b/g], ['fonts', 'lato', 'Lato'],
  ['fonts', 'montserrat', 'Montserrat'], ['fonts', 'sfpro', 'SF Pro', /\bsf pro\b|\bsan francisco\b/g], ['fonts', 'poppins', 'Poppins'], ['fonts', 'ibmplex', 'IBM Plex', /\bibm plex\b/g],
  ['gateway', 'kong', 'Kong'], ['gateway', 'apigee', 'Apigee'], ['gateway', 'tyk', 'Tyk'], ['gateway', 'awsapigateway', 'AWS API Gateway', /\b(?:aws |amazon )api gateway\b/g], ['gateway', 'traefik', 'Traefik'],
  ['gateway', 'envoy', 'Envoy'],
  ['versioning', 'semver', 'SemVer'], ['versioning', 'calver', 'CalVer'],
  ['region', 'euregion', 'the EU'], ['region', 'usregion', 'the US'], ['region', 'apacregion', 'APAC'],
];

const PRODUCT = new Map();
for (const [category, token, display] of PRODUCTS) {
  const p = PRODUCT.get(token) ?? { token, display, categories: [] };
  p.categories.push(category);
  PRODUCT.set(token, p);
}

// "written in Go", "Go services": the language, not the verb. Applied before lower-casing.
function golang(text) {
  return String(text ?? '')
    .replace(/\bgolang\b/gi, ' golang ')
    .replace(/(?<=\b(?:in|with|using|use|adopt|of|rewrite in|port to|than)\s+)Go\b/g, ' golang ')
    .replace(/\bGo(?=\s+(?:services?|code|modules?|tests?|binar(?:y|ies)|programs?|librar(?:y|ies)|microservices?|backend|workers?|SDK|versions?|\d))/g, ' golang ')
    .replace(/^\s*Go\s*$/, ' golang ')
    .replace(/\b(?:the )?U\.?S\.?(?=[\s,;.]|$)(?!\.\w)/g, ' usregion ');
}

const CONCEPTS = [...BASE_CONCEPTS, ...PRODUCTS.filter((p) => p[3]).map(([, token, , re]) => [re, ` ${token} `])];

// Tokens produced by concepts are canonical: they are never stemmed, so they stay readable in explanations.
const CANONICAL = new Set([...PRODUCT.keys()]);
for (const [, rep] of BASE_CONCEPTS) for (const w of rep.replace(/\$&|\$\d/g, ' ').split(/\s+/)) if (w) CANONICAL.add(w);

// Words that carry little meaning for matching. Kept short on purpose: domain words stay in.
const STOP = new Set(
  ('a an and are as at be been but by can could do does for from had has have how i if in into is it its ' +
    'may might more most must no not of on or our out over per should so than that the their them then there ' +
    'these they this those to too up us was we were what when where which while who will with would you your ' +
    'all any also each every other such only own same just via etc eg ie new use using used uses make made ' +
    'add adding added team teams work need needs needed want wants able going get got let lets ' +
    'back keep still already every last next week weekend day days time times nobody anyone someone many ' +
    'much few lot lots one two three first second without within before after again ever like am below above higher lower earlier later older newer between among across').split(' '),
);

/** Very light stemmer: enough to match plurals and simple verb forms ("cache", "caching" and "cached" agree). */
export function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(?:ss|us|is)$/.test(w)) return w;
  if (/(?:sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) w = w.slice(0, -1);
  else if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4 && !/(?:ee|ie|ue|ye|oe)$/.test(w)) w = w.slice(0, -1);
  return w;
}

// Common but weak words: they count a little in term matching, never on their own.
const GENERIC_WORDS =
  'service services system systems data app apps application applications user users customer customers ' +
  'feature features platform platforms support process tool tools provider providers flow flows update ' +
  'updates option options approach solution solutions change changes implementation project api apis ' +
  'layer component components new existing current fallback default primary directly direct internal ' +
  'external own them it thing things way ways part parts our general overall build building web job jobs ' +
  'log logs release releases product products page pages version versions account accounts file files ' +
  'code test tests error errors request requests event events setting settings screen screens';
export const GENERIC = new Set(GENERIC_WORDS.split(' ').flatMap((w) => [w, stem(w)]));

/** Lower-cases, strips accents, expands contractions and applies concept synonyms, returning a cleaned string. */
export function normalize(text) {
  let s = golang(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”]/g, "'")
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/n't\b/g, ' not')
    .replace(/'(?:ll)\b/g, ' will')
    .replace(/'re\b/g, ' are')
    .replace(/'ve\b/g, ' have')
    .replace(/'d\b/g, ' would')
    .replace(/'m\b/g, ' am')
    .replace(/'s\b/g, '');
  for (const [re, rep] of CONCEPTS) s = s.replace(re, rep);
  return s.replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Content tokens: normalised, stop words removed, stemmed. Keeps order (duplicates allowed). */
export function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d{1,2}$/.test(t))
    .map((t) => (CANONICAL.has(t) ? t : stem(t)));
}

/** Token set helper. */
export function tokenSet(text) {
  return new Set(tokens(text));
}

/** The product a token names, if any: {token, display, categories}. */
export function product(tok) {
  return PRODUCT.get(tok) ?? null;
}

/** Display label and scope words of a product category. */
export function category(name) {
  const c = CATEGORIES[name];
  if (!c) return null;
  c.wordSet ??= new Set(tokens(c.words));
  return c;
}

// Human labels for canonical concept tokens (used when explaining a match).
const DISPLAY = {
  mfa: '2FA',
  otp: 'one-time passcodes',
  sms: 'SMS',
  passkey: 'passkeys',
  totp: 'authenticator apps',
  llm: 'LLMs',
  featureflag: 'feature flags',
  pushnotification: 'push notifications',
  fcm: 'Firebase Cloud Messaging',
  pii: 'personal data',
  cardnumber: 'card numbers',
  callrecording: 'call recordings',
  transcript: 'transcripts',
  thirdparty: 'third parties',
  inhouse: 'in-house builds',
  selfhosted: 'self-hosting',
  onprem: 'on-premises',
  oncall: 'on-call',
  dataresidency: 'data residency',
  appstore: 'App Store',
  cicd: 'CI/CD',
  authtoken: 'auth tokens',
  passwordreset: 'password resets',
  plainjs: 'plain JavaScript',
  microfrontend: 'micro-frontends',
  hamburgermenu: 'hamburger menus',
  bluegreen: 'blue-green deployments',
  ossetting: 'the OS setting',
  adr: 'ADRs',
  localstorage: 'localStorage',
  login: 'sign-in',
  logout: 'sign-out',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  md5: 'MD5',
};

/** Readable label for a token. */
export function label(tok) {
  return DISPLAY[tok] ?? PRODUCT.get(tok)?.display ?? tok;
}

/** Weight of a token in term matching. */
export function weight(tok) {
  return GENERIC.has(tok) ? 0.3 : 1;
}

/** Splits text into sentences (rough, good enough for decision statements and issue descriptions). */
export function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
