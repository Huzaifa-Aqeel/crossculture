-- Pre-marker responses have unknown provenance. Fail closed until individually reviewed.
update private.qloo_responses set sample_data = true;
alter table private.qloo_responses alter column sample_data set default true;
