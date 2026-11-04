<?php

namespace App\Application\Services;

use RuntimeException;

class QuotationConversionException extends RuntimeException
{
    /**
     * @param  list<array<string, mixed>>  $insufficient
     */
    public function __construct(
        string $message,
        public readonly string $errorCode = 'conversion_failed',
        public readonly array $insufficient = [],
        int $httpStatus = 422,
    ) {
        parent::__construct($message, $httpStatus);
    }
}
