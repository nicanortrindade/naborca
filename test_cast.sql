SELECT string_to_array(regexp_replace('12.2', '[^0-9.]', '', 'g'), '.')::int[];
