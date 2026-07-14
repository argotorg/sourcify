-- migrate:up

-- Tag each stored bytecode with the VM it targets. Defaults to "evm" so all
-- existing and EVM contracts keep the default; ZKsync/zksolc bytecode is stored
-- as "eravm". Kept as a free-form varchar (no CHECK) so new VMs can be added
-- without a schema migration.
ALTER TABLE code
  ADD COLUMN vm character varying NOT NULL DEFAULT 'evm';

-- migrate:down

ALTER TABLE code
  DROP COLUMN vm;
