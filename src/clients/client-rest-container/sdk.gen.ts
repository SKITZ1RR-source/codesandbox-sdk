// This file is auto-generated by @hey-api/openapi-ts

import type { Options as ClientOptions, TDataShape, Client } from '@hey-api/client-fetch';
import type { ContainerSetupData, ContainerSetupResponse, ContainerSetupError } from './types.gen';
import { client as _heyApiClient } from './client.gen';

export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean> = ClientOptions<TData, ThrowOnError> & {
    /**
     * You can provide a client instance returned by `createClient()` instead of
     * individual options. This might be also useful if you want to implement a
     * custom client.
     */
    client?: Client;
};

/**
 * Setup container
 * Set up a new container based on a template
 */
export const containerSetup = <ThrowOnError extends boolean = false>(options: Options<ContainerSetupData, ThrowOnError>) => {
    return (options.client ?? _heyApiClient).post<ContainerSetupResponse, ContainerSetupError, ThrowOnError>({
        url: '/container/setup',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers
        }
    });
};