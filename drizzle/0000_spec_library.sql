CREATE TABLE `packpilot_specs` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `config_json` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `packpilot_spec_library_meta` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);
