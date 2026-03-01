--
-- PostgreSQL database dump
--

\restrict sc5r0K995crTY4M9QdNQJIDqfnN71nDJJaWgvZMFqZjOxOHOmXgEz93yiDcz9o1

-- Dumped from database version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: campaign_investments; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.campaign_investments (
    id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    investor_address text NOT NULL,
    usdc_amount_base_units bigint NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.campaign_investments OWNER TO homeshare_user;

--
-- Name: TABLE campaign_investments; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.campaign_investments IS 'Derived from PropertyCrowdfund.Invested events.';


--
-- Name: campaign_refunds; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.campaign_refunds (
    id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    investor_address text NOT NULL,
    usdc_amount_base_units bigint NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.campaign_refunds OWNER TO homeshare_user;

--
-- Name: TABLE campaign_refunds; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.campaign_refunds IS 'Derived from PropertyCrowdfund.Refunded events.';


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.campaigns (
    id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    contract_address text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    state text NOT NULL,
    target_usdc_base_units bigint NOT NULL,
    raised_usdc_base_units bigint DEFAULT 0 NOT NULL,
    finalized_tx_hash text,
    finalized_log_index integer,
    finalized_block_number bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaigns_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'SUCCESS'::text, 'FAILED'::text, 'WITHDRAWN'::text])))
);


ALTER TABLE public.campaigns OWNER TO homeshare_user;

--
-- Name: TABLE campaigns; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.campaigns IS 'State derived from PropertyCrowdfund.Finalized/Withdrawn events.';


--
-- Name: equity_claims; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.equity_claims (
    id uuid NOT NULL,
    campaign_id uuid,
    property_id uuid NOT NULL,
    equity_token_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    claimant_address text NOT NULL,
    equity_amount_base_units numeric(78,0) NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.equity_claims OWNER TO homeshare_user;

--
-- Name: TABLE equity_claims; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.equity_claims IS 'Derived from PropertyCrowdfund.TokensClaimed events.';


--
-- Name: equity_tokens; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.equity_tokens (
    id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    contract_address text NOT NULL,
    property_id_string text,
    admin_address text,
    initial_holder_address text,
    total_supply_base_units numeric(78,0) NOT NULL,
    created_tx_hash text NOT NULL,
    created_log_index integer NOT NULL,
    created_block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.equity_tokens OWNER TO homeshare_user;

--
-- Name: TABLE equity_tokens; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.equity_tokens IS 'Derived from EquityToken deployment (constructor args).';


--
-- Name: indexer_state; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.indexer_state (
    chain_id bigint NOT NULL,
    last_block bigint NOT NULL
);


ALTER TABLE public.indexer_state OWNER TO homeshare_user;

--
-- Name: investments; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.investments (
    id uuid NOT NULL,
    property_id uuid NOT NULL,
    investor text NOT NULL,
    amount numeric(18,2) NOT NULL,
    token_amount numeric(18,2) NOT NULL,
    chain text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.investments OWNER TO homeshare_user;

--
-- Name: profit_claims; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.profit_claims (
    id uuid NOT NULL,
    profit_distributor_id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    claimer_address text NOT NULL,
    usdc_amount_base_units bigint NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profit_claims OWNER TO homeshare_user;

--
-- Name: TABLE profit_claims; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.profit_claims IS 'Derived from ProfitDistributor.Claimed events.';


--
-- Name: profit_deposits; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.profit_deposits (
    id uuid NOT NULL,
    profit_distributor_id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    depositor_address text NOT NULL,
    usdc_amount_base_units bigint NOT NULL,
    acc_profit_per_share numeric(78,0) NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profit_deposits OWNER TO homeshare_user;

--
-- Name: TABLE profit_deposits; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.profit_deposits IS 'Derived from ProfitDistributor.Deposited events.';


--
-- Name: profit_distribution_intents; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.profit_distribution_intents (
    id uuid NOT NULL,
    chain_id bigint NOT NULL,
    property_id text NOT NULL,
    profit_distributor_address text NOT NULL,
    usdc_amount_base_units bigint NOT NULL,
    created_by_address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profit_distribution_intents OWNER TO homeshare_user;

--
-- Name: profit_distributors; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.profit_distributors (
    id uuid NOT NULL,
    property_id uuid NOT NULL,
    chain_id bigint NOT NULL,
    contract_address text NOT NULL,
    usdc_token_address text NOT NULL,
    equity_token_address text NOT NULL,
    created_tx_hash text NOT NULL,
    created_log_index integer NOT NULL,
    created_block_number bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profit_distributors OWNER TO homeshare_user;

--
-- Name: TABLE profit_distributors; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.profit_distributors IS 'Derived from ProfitDistributor deployment.';


--
-- Name: properties; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.properties (
    id uuid NOT NULL,
    name text NOT NULL,
    location text NOT NULL,
    description text NOT NULL,
    total_value numeric(18,2) NOT NULL,
    token_supply numeric(18,2) NOT NULL,
    chain text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.properties OWNER TO homeshare_user;

--
-- Name: TABLE properties; Type: COMMENT; Schema: public; Owner: homeshare_user
--

COMMENT ON TABLE public.properties IS 'Derived from PropertyCrowdfund deployment (constructor args).';


--
-- Name: property_intents; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.property_intents (
    id uuid NOT NULL,
    chain_id bigint NOT NULL,
    property_id text NOT NULL,
    name text NOT NULL,
    location text NOT NULL,
    description text NOT NULL,
    target_usdc_base_units bigint NOT NULL,
    crowdfund_contract_address text,
    created_by_address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.property_intents OWNER TO homeshare_user;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.schema_migrations (
    id integer NOT NULL,
    name text NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO homeshare_user;

--
-- Name: schema_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: homeshare_user
--

CREATE SEQUENCE public.schema_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.schema_migrations_id_seq OWNER TO homeshare_user;

--
-- Name: schema_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: homeshare_user
--

ALTER SEQUENCE public.schema_migrations_id_seq OWNED BY public.schema_migrations.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: homeshare_user
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    address text NOT NULL,
    role text DEFAULT 'investor'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO homeshare_user;

--
-- Name: schema_migrations id; Type: DEFAULT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.schema_migrations ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_id_seq'::regclass);


--
-- Data for Name: campaign_investments; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.campaign_investments (id, campaign_id, property_id, chain_id, investor_address, usdc_amount_base_units, tx_hash, log_index, block_number, created_at) FROM stdin;
\.


--
-- Data for Name: campaign_refunds; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.campaign_refunds (id, campaign_id, property_id, chain_id, investor_address, usdc_amount_base_units, tx_hash, log_index, block_number, created_at) FROM stdin;
\.


--
-- Data for Name: campaigns; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.campaigns (id, property_id, chain_id, contract_address, start_time, end_time, state, target_usdc_base_units, raised_usdc_base_units, finalized_tx_hash, finalized_log_index, finalized_block_number, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: equity_claims; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.equity_claims (id, campaign_id, property_id, equity_token_id, chain_id, claimant_address, equity_amount_base_units, tx_hash, log_index, block_number, created_at) FROM stdin;
\.


--
-- Data for Name: equity_tokens; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.equity_tokens (id, property_id, chain_id, contract_address, property_id_string, admin_address, initial_holder_address, total_supply_base_units, created_tx_hash, created_log_index, created_block_number, created_at) FROM stdin;
\.


--
-- Data for Name: indexer_state; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.indexer_state (chain_id, last_block) FROM stdin;
84532	37222730
\.


--
-- Data for Name: investments; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.investments (id, property_id, investor, amount, token_amount, chain, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: profit_claims; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.profit_claims (id, profit_distributor_id, property_id, chain_id, claimer_address, usdc_amount_base_units, tx_hash, log_index, block_number, created_at) FROM stdin;
\.


--
-- Data for Name: profit_deposits; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.profit_deposits (id, profit_distributor_id, property_id, chain_id, depositor_address, usdc_amount_base_units, acc_profit_per_share, tx_hash, log_index, block_number, created_at) FROM stdin;
\.


--
-- Data for Name: profit_distribution_intents; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.profit_distribution_intents (id, chain_id, property_id, profit_distributor_address, usdc_amount_base_units, created_by_address, created_at) FROM stdin;
\.


--
-- Data for Name: profit_distributors; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.profit_distributors (id, property_id, chain_id, contract_address, usdc_token_address, equity_token_address, created_tx_hash, created_log_index, created_block_number, created_at) FROM stdin;
\.


--
-- Data for Name: properties; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.properties (id, name, location, description, total_value, token_supply, chain, status, created_at, updated_at) FROM stdin;
7af98025-3115-45f6-97d4-9e6b70495b33	AAA	KANO	GOOD	1000.00	100.00	base-sepolia	funding	2026-02-01 12:12:19.514+01	2026-02-01 12:12:19.514+01
83f8d3e6-8339-4db0-b479-96e5f1129980	AA2	MARADI	BAD	100000.00	590.00	sepolia	funding	2026-02-01 22:23:30.786+01	2026-02-01 22:23:30.786+01
\.


--
-- Data for Name: property_intents; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.property_intents (id, chain_id, property_id, name, location, description, target_usdc_base_units, crowdfund_contract_address, created_by_address, created_at) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.schema_migrations (id, name, run_at) FROM stdin;
1	001-init.sql	2026-01-31 17:14:43.321312+01
2	002-users.sql	2026-01-31 17:14:43.445678+01
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: homeshare_user
--

COPY public.users (id, address, role, created_at, updated_at) FROM stdin;
196fc2e3-41a9-4a51-a781-0b2d76f274f5	0x55969f698c689413f15e37bb52cbe560824c9fdd	owner	2026-02-01 12:11:24.951+01	2026-02-01 12:11:24.951+01
\.


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: homeshare_user
--

SELECT pg_catalog.setval('public.schema_migrations_id_seq', 2, true);


--
-- Name: campaign_investments campaign_investments_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_investments
    ADD CONSTRAINT campaign_investments_pkey PRIMARY KEY (id);


--
-- Name: campaign_investments campaign_investments_tx_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_investments
    ADD CONSTRAINT campaign_investments_tx_hash_log_index_key UNIQUE (tx_hash, log_index);


--
-- Name: campaign_refunds campaign_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_refunds
    ADD CONSTRAINT campaign_refunds_pkey PRIMARY KEY (id);


--
-- Name: campaign_refunds campaign_refunds_tx_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_refunds
    ADD CONSTRAINT campaign_refunds_tx_hash_log_index_key UNIQUE (tx_hash, log_index);


--
-- Name: campaigns campaigns_contract_address_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_contract_address_key UNIQUE (contract_address);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: equity_claims equity_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_claims
    ADD CONSTRAINT equity_claims_pkey PRIMARY KEY (id);


--
-- Name: equity_claims equity_claims_tx_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_claims
    ADD CONSTRAINT equity_claims_tx_hash_log_index_key UNIQUE (tx_hash, log_index);


--
-- Name: equity_tokens equity_tokens_contract_address_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_tokens
    ADD CONSTRAINT equity_tokens_contract_address_key UNIQUE (contract_address);


--
-- Name: equity_tokens equity_tokens_created_tx_hash_created_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_tokens
    ADD CONSTRAINT equity_tokens_created_tx_hash_created_log_index_key UNIQUE (created_tx_hash, created_log_index);


--
-- Name: equity_tokens equity_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_tokens
    ADD CONSTRAINT equity_tokens_pkey PRIMARY KEY (id);


--
-- Name: indexer_state indexer_state_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.indexer_state
    ADD CONSTRAINT indexer_state_pkey PRIMARY KEY (chain_id);


--
-- Name: investments investments_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_pkey PRIMARY KEY (id);


--
-- Name: profit_claims profit_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_claims
    ADD CONSTRAINT profit_claims_pkey PRIMARY KEY (id);


--
-- Name: profit_claims profit_claims_tx_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_claims
    ADD CONSTRAINT profit_claims_tx_hash_log_index_key UNIQUE (tx_hash, log_index);


--
-- Name: profit_deposits profit_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_deposits
    ADD CONSTRAINT profit_deposits_pkey PRIMARY KEY (id);


--
-- Name: profit_deposits profit_deposits_tx_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_deposits
    ADD CONSTRAINT profit_deposits_tx_hash_log_index_key UNIQUE (tx_hash, log_index);


--
-- Name: profit_distribution_intents profit_distribution_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_distribution_intents
    ADD CONSTRAINT profit_distribution_intents_pkey PRIMARY KEY (id);


--
-- Name: profit_distributors profit_distributors_contract_address_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_distributors
    ADD CONSTRAINT profit_distributors_contract_address_key UNIQUE (contract_address);


--
-- Name: profit_distributors profit_distributors_created_tx_hash_created_log_index_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_distributors
    ADD CONSTRAINT profit_distributors_created_tx_hash_created_log_index_key UNIQUE (created_tx_hash, created_log_index);


--
-- Name: profit_distributors profit_distributors_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_distributors
    ADD CONSTRAINT profit_distributors_pkey PRIMARY KEY (id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: property_intents property_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.property_intents
    ADD CONSTRAINT property_intents_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_name_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_name_key UNIQUE (name);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: users users_address_key; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_address_key UNIQUE (address);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: campaign_investments_campaign_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX campaign_investments_campaign_idx ON public.campaign_investments USING btree (campaign_id);


--
-- Name: campaign_investments_investor_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX campaign_investments_investor_idx ON public.campaign_investments USING btree (investor_address);


--
-- Name: campaign_refunds_campaign_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX campaign_refunds_campaign_idx ON public.campaign_refunds USING btree (campaign_id);


--
-- Name: campaign_refunds_investor_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX campaign_refunds_investor_idx ON public.campaign_refunds USING btree (investor_address);


--
-- Name: campaigns_contract_address_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX campaigns_contract_address_idx ON public.campaigns USING btree (contract_address);


--
-- Name: campaigns_property_id_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX campaigns_property_id_idx ON public.campaigns USING btree (property_id);


--
-- Name: equity_claims_claimant_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX equity_claims_claimant_idx ON public.equity_claims USING btree (claimant_address);


--
-- Name: equity_claims_equity_token_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX equity_claims_equity_token_idx ON public.equity_claims USING btree (equity_token_id);


--
-- Name: equity_tokens_contract_address_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX equity_tokens_contract_address_idx ON public.equity_tokens USING btree (contract_address);


--
-- Name: equity_tokens_property_id_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX equity_tokens_property_id_idx ON public.equity_tokens USING btree (property_id);


--
-- Name: profit_claims_claimer_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_claims_claimer_idx ON public.profit_claims USING btree (claimer_address);


--
-- Name: profit_claims_distributor_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_claims_distributor_idx ON public.profit_claims USING btree (profit_distributor_id);


--
-- Name: profit_deposits_depositor_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_deposits_depositor_idx ON public.profit_deposits USING btree (depositor_address);


--
-- Name: profit_deposits_distributor_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_deposits_distributor_idx ON public.profit_deposits USING btree (profit_distributor_id);


--
-- Name: profit_distribution_intents_distributor_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_distribution_intents_distributor_idx ON public.profit_distribution_intents USING btree (profit_distributor_address);


--
-- Name: profit_distribution_intents_property_id_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_distribution_intents_property_id_idx ON public.profit_distribution_intents USING btree (property_id);


--
-- Name: profit_distributors_contract_address_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_distributors_contract_address_idx ON public.profit_distributors USING btree (contract_address);


--
-- Name: profit_distributors_property_id_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX profit_distributors_property_id_idx ON public.profit_distributors USING btree (property_id);


--
-- Name: property_intents_chain_id_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX property_intents_chain_id_idx ON public.property_intents USING btree (chain_id);


--
-- Name: property_intents_property_id_idx; Type: INDEX; Schema: public; Owner: homeshare_user
--

CREATE INDEX property_intents_property_id_idx ON public.property_intents USING btree (property_id);


--
-- Name: campaign_investments campaign_investments_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_investments
    ADD CONSTRAINT campaign_investments_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_investments campaign_investments_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_investments
    ADD CONSTRAINT campaign_investments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: campaign_refunds campaign_refunds_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_refunds
    ADD CONSTRAINT campaign_refunds_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_refunds campaign_refunds_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaign_refunds
    ADD CONSTRAINT campaign_refunds_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: equity_claims equity_claims_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_claims
    ADD CONSTRAINT equity_claims_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: equity_claims equity_claims_equity_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_claims
    ADD CONSTRAINT equity_claims_equity_token_id_fkey FOREIGN KEY (equity_token_id) REFERENCES public.equity_tokens(id) ON DELETE CASCADE;


--
-- Name: equity_claims equity_claims_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_claims
    ADD CONSTRAINT equity_claims_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: equity_tokens equity_tokens_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.equity_tokens
    ADD CONSTRAINT equity_tokens_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: investments investments_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: profit_claims profit_claims_profit_distributor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_claims
    ADD CONSTRAINT profit_claims_profit_distributor_id_fkey FOREIGN KEY (profit_distributor_id) REFERENCES public.profit_distributors(id) ON DELETE CASCADE;


--
-- Name: profit_claims profit_claims_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_claims
    ADD CONSTRAINT profit_claims_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: profit_deposits profit_deposits_profit_distributor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_deposits
    ADD CONSTRAINT profit_deposits_profit_distributor_id_fkey FOREIGN KEY (profit_distributor_id) REFERENCES public.profit_distributors(id) ON DELETE CASCADE;


--
-- Name: profit_deposits profit_deposits_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_deposits
    ADD CONSTRAINT profit_deposits_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: profit_distributors profit_distributors_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: homeshare_user
--

ALTER TABLE ONLY public.profit_distributors
    ADD CONSTRAINT profit_distributors_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict sc5r0K995crTY4M9QdNQJIDqfnN71nDJJaWgvZMFqZjOxOHOmXgEz93yiDcz9o1

