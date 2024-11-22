// utils/helpers.js

export function makeError(message) {
    return {
        success: false,
        message: message || 'Something went wrong',
    };
}

export function makeJuspayResponse(response) {
    if (response === undefined) return response;
    if (response.http !== undefined) delete response.http; // Remove HTTP field if present
    return {
        success: true,
        data: response,
    };
}
