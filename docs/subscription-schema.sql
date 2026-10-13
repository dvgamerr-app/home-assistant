-- Reference SQL generated from 006_subscriptions.ts. Apply through the migration runner.

create table "subscription_account" ("id" uuid primary key, "name" varchar(100) not null, "identifier" varchar(254) default '' not null, "created_by" text references "user" ("id") on delete set null, "updated_by" text references "user" ("id") on delete set null, "version" integer default 1 not null, "created_at" timestamptz default now() not null, "updated_at" timestamptz default now() not null, constraint "subscription_account_name_check" check (length(trim(name)) > 0));

CREATE UNIQUE INDEX subscription_account_identity_key ON subscription_account (lower(name), lower(identifier));

create table "subscription" ("id" uuid primary key, "account_id" uuid not null references "subscription_account" ("id") on delete restrict, "service" varchar(100) not null, "plan" varchar(100) default '' not null, "amount_minor" integer not null, "currency" varchar(3) default 'THB' not null, "billing_day" integer not null, "status" varchar(12) default 'active' not null, "url" varchar(2048) default '' not null, "notes" varchar(1000) default '' not null, "created_by" text references "user" ("id") on delete set null, "updated_by" text references "user" ("id") on delete set null, "version" integer default 1 not null, "created_at" timestamptz default now() not null, "updated_at" timestamptz default now() not null, constraint "subscription_service_check" check (length(trim(service)) > 0), constraint "subscription_amount_check" check (amount_minor >= 0 AND amount_minor <= 100000000), constraint "subscription_currency_check" check (currency IN ('THB', 'USD', 'EUR', 'GBP', 'SGD')), constraint "subscription_day_check" check (billing_day BETWEEN 1 AND 31), constraint "subscription_status_check" check (status IN ('active', 'paused', 'cancelled')));

create index "subscription_account_idx" on "subscription" ("account_id");

CREATE UNIQUE INDEX subscription_service_plan_key ON subscription (account_id, lower(service), lower(plan));
